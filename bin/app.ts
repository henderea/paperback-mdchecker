import type { Server } from 'http';
import type { Application, Request, Response, NextFunction, Router } from 'express';

import type { User } from 'lib/UserList';
import type { UpdateCheckResult, MangaInfo, TitledMangaInfo, MangaUpdateInfo, FailedTitle } from 'lib/db';

import { expressPort, expressHost, expressSocketPath, userUpdateSchedule, noStartStopLogs, baseUrl } from 'lib/env';

import schedule from 'node-schedule';

import express from 'express';
import nunjucks from 'nunjucks';
import { minify } from 'html-minifier-terser';
import { createHttpTerminator } from 'http-terminator';


import { sessionMiddleware, shutdownRedis } from 'lib/session';

import { shutdownClient, getLastUpdate, getLastUserCheck, getUserUpdates, getUserChecks, insertMangaRecord, updateMangaRecordForCheck, getLastCheck, getLatestUpdateCheck, getUnknownTitles, getNonLatinTitles, getFailedTitles } from 'lib/db';

import { shutdownHandler } from 'lib/ShutdownHandler';

import { UserList } from 'lib/UserList';

import { Duration, formatEpoch, formatDuration, ensureInt, formatDurationShort } from 'lib/utils';

declare global {
  namespace Express {
    interface Request {
      userId: string | undefined;
      user: User | undefined;
    }
    interface Response {
      renderMinified(view: string, options?: object): Promise<void>;
    }
  }
}

const app: Application = express();

app.set('trust proxy', 1);

const router: Router = express.Router();

function isEmpty(value: string | any[] | null | undefined): boolean {
  return value === null || value === undefined || !value.length || value.length == 0;
}

nunjucks.configure('views', {
  autoescape: true,
  express: app
})
  .addGlobal('now', function now() {
    return Date.now();
  })
  .addFilter('notEmpty', function notEmpty(value: string | any[] | null | undefined): boolean {
    return !isEmpty(value);
  })
  .addFilter('isEmpty', function isEmpty(value: string | any[] | null | undefined): boolean {
    return isEmpty(value);
  });

router.use(sessionMiddleware);

router.use(express.static('public', { index: false }));

const users: UserList = new UserList();

schedule.scheduleJob(userUpdateSchedule, () => users.update());

users.update();

router.use((req: Request, res: Response, next: NextFunction) => {
  res.renderMinified = function(view: string, options?: object): Promise<void> {
    return new Promise((resolve, reject) => {
      this.render(view, options, function(err: Error, html: string) {
        if(err) { return reject(err); }
        minify(html, { collapseWhitespace: true, preserveLineBreaks: true }).then((minified) => {
          res.send(minified);
          resolve();
        });
      });
    });
  };
  next();
});

function getUser(userId: string | null | undefined): User | undefined {
  return users.getUser(userId);
}

router.use((req: Request, res: Response, next: NextFunction) => {
  res.locals.basePath = (req.baseUrl || '').replace(/\/$/, '');
  next();
});

router.use((req: Request, _res: Response, next: NextFunction) => {
  const userId: string | undefined = req.query.userId as string | undefined;
  req.userId = userId;
  req.user = getUser(userId);
  next();
});

declare type State = 'unknown' | 'updated' | 'current' | 'no-user' | 'error';

declare type DetermineStateResponse = { state: State, epoch: number };

async function determineState(lastCheckHit: number | undefined, userId: string, mangaId: string, lastCheckEpoch: number, currentEpoch: number): Promise<DetermineStateResponse> {
  try {
    const lastCheck: number = await getLastCheck(userId, mangaId);
    const lastUpdate: number = await getLastUpdate(userId, mangaId);
    if(lastUpdate < 0 || lastCheck < 0) { // not fetched before
      await insertMangaRecord(userId, mangaId, currentEpoch);
      return { state: 'unknown', epoch: lastCheckEpoch };
    }
    await updateMangaRecordForCheck(userId, mangaId, currentEpoch);
    if(lastCheck < (currentEpoch - Duration.DAYS(6))) { // hasn't been fetched recently, so the checker may not have been checking it
      return { state: 'unknown', epoch: lastCheck };
    }
    if(!lastCheckHit || (currentEpoch - lastCheckHit) > Duration.SECONDS(2)) { // if we haven't been checking a bunch of series quickly, this may be a regular series view load, so tell it to fetch data
      return { state: 'updated', epoch: lastCheck };
    }
    return { state: lastUpdate < lastCheckEpoch ? 'current' : 'updated', epoch: lastCheck };
  } catch (e) {
    console.error('Encountered error determining state', e);
    return { state: 'error', epoch: lastCheckEpoch };
  }
}

/**
 * query: userId
 * query: mangaId
 * query: lastCheckEpoch
 *
 * returns: { epoch, state } (as json)
 * where epoch is a number and state is 'unknown', 'updated', 'current', 'no-user', or 'error'
 */
router.get('/manga-check', async (req: Request, res: Response) => {
  try {
    const user: User | undefined = req.user;
    if(!user) { // if the user isn't in the table, reject the request right away
      res.json({ epoch: 0, state: 'no-user' });
      return;
    }
    const userId: string = user.userId;
    const mangaId: string | undefined = req.query.mangaId as string | undefined;
    if(!mangaId) {
      res.json({ epoch: 0, state: 'error' });
      return;
    }
    const lastCheckEpoch: number = ensureInt(req.query.lastCheckEpoch ?? '0');
    const currentEpoch: number = Date.now();
    const { state, epoch } = await determineState(req.session.lastCheck, userId, mangaId, lastCheckEpoch, currentEpoch);
    req.session.lastCheck = Date.now();
    req.session.save(() => res.json({ epoch, state }));
  } catch (e) {
    console.error('Encountered error in request handler', e);
    res.json({ epoch: 0, state: 'error' });
  }
});

/**
 * when the update check process got a service unavailable (503) response
 */
declare type UpdateCheckStateServiceUnavailable = 'service-unavailable';

/**
 * when the update check process failed
 */
declare type UpdateCheckStateFailed = 'failed';

/**
 * when there were no series to check because nothing has been fetched in the past week.
 */
declare type UpdateCheckStateNoSeries = 'no-series';

/**
 * when the update check process ended with an unknown non-success response
 */
declare type UpdateCheckStateUnknownResult = 'unknown-result';

declare type EndedUpdateCheckState = 'completed' | UpdateCheckStateServiceUnavailable | UpdateCheckStateFailed | UpdateCheckStateNoSeries | UpdateCheckStateUnknownResult;
declare type UpdateCheckState = 'no-user' | 'unknown' | 'error' | 'running' | EndedUpdateCheckState;

function prettyJsonResponse(res: Response): (data: Dictionary<any>) => void {
  return (data: Dictionary<any>) => {
    res.header('Content-Type','application/json');
    res.send(JSON.stringify(data, null, 2));
  };
}

function getUpdateCheckStateFromCount(count: number): EndedUpdateCheckState {
  if(count == -3) {
    return 'service-unavailable';
  }
  if(count == -2) {
    return 'failed';
  }
  if(count == -1) {
    return 'no-series';
  }
  if(count < 0) {
    return 'unknown-result';
  }
  return 'completed';
}

/**
 * A US-formatted date/time string in Eastern Time
 */
declare type TimeString = string;
/**
 * A formatted duration string with ms, s, m, and h (leaving a unit out if it would be 0)
 */
declare type DurationString = string;

declare interface FormattedMangaUpdateInfo extends MangaInfo {
  lastUpdateAgo: string;
}

declare type UserUpdateData = { lastUserFetch: TimeString, updatesSinceLastFetch: FormattedMangaUpdateInfo[], userChecks: number };

declare type UpdateNoUser = { state: 'no-user' };
declare type UpdateError = { state: 'error' };

declare type UpdateUnknownBase = { state: 'unknown' };
declare type UpdateUnknown = UpdateUnknownBase | (UpdateUnknownBase & UserUpdateData);

declare type UpdateRunningBase = { state: 'running', start: TimeString };
declare type UpdateRunning = UpdateRunningBase | (UpdateRunningBase & UserUpdateData);

declare type UpdateEndedBase = { state: EndedUpdateCheckState, start: TimeString, end: TimeString, duration: DurationString, count?: number };
declare type UpdateEnded = UpdateEndedBase | (UpdateEndedBase & UserUpdateData);

declare type UpdateData = UpdateNoUser | UpdateError | UpdateUnknown | UpdateRunning | UpdateEnded;


function processMangaUpdateInfo(mangas: MangaUpdateInfo[]): FormattedMangaUpdateInfo[] {
  const epoch: number = Date.now();
  return mangas.map(({ id, title, lastUpdate }) => ({ id, title, lastUpdateAgo: lastUpdate > 0 ? formatDurationShort(epoch - lastUpdate) : '???' }));
}


/**
 * query: userId
 *
 * returns pretty JSON with one of:
 *  - { state: "error" | "no-user" | "unknown" }
 *  - { state: "running", start: <time string> }
 *  - { state: "no-series" | "completed" | "failed" | "unknown-result", start: <time string>, end: <time string>, duration: <formatted duration string>, count: <number> }
 *
 * Everything other than "error" and "no-user" potentially also has these additional fields related to the provided userId:
 *  - lastUserFetch: <time string>
 *  - updatesSinceLastFetch: <number>
 *
 * "no-series" - when there were no series to check because nothing has been fetched in the past week.
 * "failed" - when the update check process failed
 * "unknown-result" - when the update check process ended with an unknown non-success response
 */
async function getUserUpdateData(user: User | undefined): Promise<UpdateData> {
  try {
    if(!user) {
      return { state: 'no-user' };
    }
    const userId: string = user.userId;
    let userData: UserUpdateData | EmptyObject = {};
    const lastUserCheck: number = await getLastUserCheck(userId);
    if(lastUserCheck > 0) {
      const lastUserFetch: TimeString = formatEpoch(lastUserCheck);
      const userUpdates: MangaUpdateInfo[] = await getUserUpdates(userId, lastUserCheck - Duration.HOURS(6));
      const userChecks: number = await getUserChecks(userId, lastUserCheck - Duration.HOURS(6));
      const updatesSinceLastFetch: FormattedMangaUpdateInfo[] = processMangaUpdateInfo(userUpdates);
      userData = { lastUserFetch, updatesSinceLastFetch, userChecks };
    }
    const lastCheck: UpdateCheckResult | null = await getLatestUpdateCheck();
    if(!lastCheck) {
      return { state: 'unknown', ...userData };
    }
    const startEpoch: number = ensureInt(lastCheck.check_start_time);
    const start: TimeString = formatEpoch(startEpoch);
    if(!lastCheck.check_end_time || lastCheck.check_end_time <= 0) {
      return {
        state: 'running',
        start,
        ...userData
      };
    }
    const endEpoch: number = ensureInt(lastCheck.check_end_time);
    const end: TimeString = formatEpoch(endEpoch);
    const duration: DurationString = formatDuration(endEpoch - startEpoch);
    const updateCount: number = lastCheck.update_count;
    const count: number | undefined = user.ifAdmin(updateCount);
    const state: UpdateCheckState = getUpdateCheckStateFromCount(updateCount);
    return {
      state,
      start,
      end,
      duration,
      count,
      ...userData
    };
  } catch (e) {
    console.error('Encountered error in last-update-check request handler', e);
    return { state: 'error' };
  }
}

router.get('/last-update-check', async (req: Request, res: Response) => {
  // const pjson: (data: UpdateData) => void = prettyJsonResponse(res);
  const render = async (updateCheck: UpdateData) => res.renderMinified('update-check.njk', { updateCheck });
  const user: User | undefined = req.user;
  await render(await getUserUpdateData(user));
});

function mapForJson(data: UpdateData): Dictionary<any> {
  if('updatesSinceLastFetch' in data) {
    const value: MangaInfo[] = data.updatesSinceLastFetch;
    return { ...data, updatesSinceLastFetch: Array.isArray(value) ? value.length : 0 };
  }
  return data;
}

router.get('/last-update-check.json', async (req: Request, res: Response) => {
  const pjson = prettyJsonResponse(res);
  const user: User | undefined = req.user;
  pjson(mapForJson(await getUserUpdateData(user)));
});

declare type UnknownTitlesState = 'no-user' | 'ok' | 'error';
declare type FailedTitleInfo = { id: string, lastFailure: TimeString };
declare type NonLatinTitleInfo = { id: string, title: string };
declare type UnknownTitlesData = { state: UnknownTitlesState, mangaIds: string[], failedTitles?: FailedTitleInfo[] | undefined, nonLatinTitles: NonLatinTitleInfo[] };

async function determineFailedTitles(): Promise<FailedTitleInfo[]> {
  const titles: FailedTitle[] | null = await getFailedTitles();
  if(!titles) {
    return [];
  }
  return titles.map((t) => ({ id: t.manga_id, lastFailure: formatEpoch(ensureInt(t.last_failure)) }));
}

async function determineNonLatinTitles(userId: string): Promise<NonLatinTitleInfo[]> {
  const titles: TitledMangaInfo[] | null = await getNonLatinTitles(userId);
  if(!titles) { return []; }
  return titles.map((t: TitledMangaInfo) => ({ id: t.manga_id, title: t.manga_title }));
}

async function getUnknownTitlesData(user: User | undefined): Promise<UnknownTitlesData> {
  try {
    if(!user) {
      return { state: 'no-user', mangaIds: [], nonLatinTitles: [] };
    }
    const userId: string = user.userId;
    const failedTitles: FailedTitleInfo[] | undefined = await user.ifAdminP(determineFailedTitles);
    const mangaIds: string[] = await getUnknownTitles(userId, user.isAdmin) ?? [];
    const nonLatinTitles: NonLatinTitleInfo[] = await determineNonLatinTitles(userId);
    return { state: 'ok', mangaIds, failedTitles, nonLatinTitles };
  } catch (e) {
    console.error('Encountered error in unknown-titles request handler', e);
    return { state: 'error', mangaIds: [], nonLatinTitles: [] };
  }
}

router.get('/unknown-titles', async (req: Request, res: Response) => {
  const render = async (unknownTitles: UnknownTitlesData) => res.renderMinified('unknown-titles.njk', { unknownTitles });
  const user: User | undefined = req.user;
  await render(await getUnknownTitlesData(user));
});

router.get('/all-info', async (req: Request, res: Response) => {
  const render = async (updateCheck: UpdateData, unknownTitles: UnknownTitlesData) => res.renderMinified('all-info.njk', { updateCheck, unknownTitles });
  const user: User | undefined = req.user;
  await render(await getUserUpdateData(user), await getUnknownTitlesData(user));
});

app.use(baseUrl, router);

function startServerListen(): Server {
  if(expressSocketPath) { // using unix socket
    return app.listen(expressSocketPath, () => {
      if(!noStartStopLogs) {
        console.log(`Server running on unix socket ${expressSocketPath}`);
      }
    });
  } else if(expressHost && expressPort) { // using host & port
    return app.listen(expressPort, expressHost, () => {
      if(!noStartStopLogs) {
        console.log(`Server running on ${expressHost}:${expressPort}`);
      }
    });
  } else if(expressPort) { // using just port
    return app.listen(expressPort, () => {
      if(!noStartStopLogs) {
        console.log(`Server running on port ${expressPort}`);
      }
    });
  } else { // nothing configured
    console.error('No valid configuration found');
    process.exit(1);
  }
}

function start(): void {
  const server: Server = startServerListen();
  const httpTerminator = createHttpTerminator({ server });
  shutdownHandler()
    .logIf('SIGINT signal received; shutting down', !noStartStopLogs)
    .thenDo(httpTerminator.terminate)
    .thenDo(schedule.gracefulShutdown)
    .thenDo(shutdownRedis)
    .thenDo(shutdownClient)
    .thenLogIf('Shutdown complete', !noStartStopLogs)
    .thenExit();
}

start();
