import type { Server } from 'http';
import type { Application, Request, Response } from 'express';

import type { User } from 'lib/UserList';
import type { UpdateCheckResult, MangaInfo } from 'lib/db';

import { expressPort, expressHost, expressSocketPath, userUpdateSchedule, noStartStopLogs } from 'lib/env';

import schedule from 'node-schedule';

import express from 'express';
import { createHttpTerminator } from 'http-terminator';


import { shutdownClient, getRecentCheckCount, getLastUpdate, getLastUserCheck, getUserUpdates, insertMangaRecord, updateMangaRecordForCheck, getLastCheck, getLatestUpdateCheck } from 'lib/db';

import { shutdownHandler } from 'lib/ShutdownHandler';

import { UserList } from 'lib/UserList';

import { Duration, formatEpoch, formatDuration, ensureInt } from 'lib/utils';

const app: Application = express();

app.set('view engine', 'ejs');

app.use(express.static('public', { index: false }));

const users: UserList = new UserList();

schedule.scheduleJob(userUpdateSchedule, () => users.update());

users.update();

function checkUser(userId: string | null | undefined): boolean {
  return users.hasUser(userId);
}

function getUser(userId: string | null | undefined): User | undefined {
  return users.getUser(userId);
}

declare type State = 'unknown' | 'updated' | 'current' | 'no-user' | 'error';

async function determineState(userId: string, mangaId: string, lastCheckEpoch: number, epoch: number): Promise<State> {
  try {
    const recentCheckCount: number = await getRecentCheckCount(userId, epoch - Duration.SECONDS(5));
    const lastCheck: number = await getLastCheck(userId, mangaId);
    const lastUpdate: number = await getLastUpdate(userId, mangaId);
    if(lastUpdate < 0 || lastCheck < 0) { // not fetched before
      await insertMangaRecord(userId, mangaId, epoch);
      return 'unknown';
    }
    await updateMangaRecordForCheck(userId, mangaId, epoch);
    if(lastCheck < (epoch - Duration.DAYS(6))) { // hasn't been fetched recently, so the checker may not have been checking it
      return 'unknown';
    }
    if(recentCheckCount < 2) { // if we haven't been checking a bunch of series quickly, this may be a regular series view load, so tell it to fetch data
      return 'updated';
    }
    return lastUpdate < lastCheckEpoch ? 'current' : 'updated';
  } catch (e) {
    console.error('Encountered error determining state', e);
    return 'error';
  }
}

/**
 * Header: user-id
 * query: mangaId
 * query: lastCheckEpoch
 *
 * returns: { epoch, state } (as json)
 * where epoch is a number and state is 'unknown', 'updated', 'current', 'no-user', or 'error'
 */
app.get('/manga-check', async (req: Request, res: Response) => {
  try {
    const userId: string | undefined = req.header('user-id');
    if(!userId || !checkUser(userId)) { // if the user isn't in the table, reject the request right away
      res.json({ epoch: 0, state: 'no-user' });
      return;
    }
    const mangaId: string | undefined = req.query.mangaId as string | undefined;
    if(!mangaId) {
      res.json({ epoch: 0, state: 'error' });
      return;
    }
    const lastCheckEpoch: number = ensureInt(req.query.lastCheckEpoch ?? '0');
    const epoch: number = Date.now();
    const state: State = await determineState(userId, mangaId, lastCheckEpoch, epoch);
    res.json({ epoch, state });
  } catch (e) {
    console.error('Encountered error in request handler', e);
    res.json({ epoch: 0, state: 'error' });
  }
});

/**
 * when the update check process failed
 */
type UpdateCheckStateFailed = 'failed';

/**
 * when there were no series to check because nothing has been fetched in the past week.
 */
type UpdateCheckStateNoSeries = 'no-series';

/**
 * when the update check process ended with an unknown non-success response
 */
type UpdateCheckStateUnknownResult = 'unknown-result';

type EndedUpdateCheckState = 'completed' | UpdateCheckStateFailed | UpdateCheckStateNoSeries | UpdateCheckStateUnknownResult;
type UpdateCheckState = 'no-user' | 'unknown' | 'error' | 'running' | EndedUpdateCheckState;

function prettyJsonResponse(res: Response): (data: Dictionary<any>) => void {
  return (data: Dictionary<any>) => {
    res.header('Content-Type','application/json');
    res.send(JSON.stringify(data, null, 2));
  };
}

function getUpdateCheckStateFromCount(count: number): EndedUpdateCheckState {
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
type TimeString = string;
/**
 * A formatted duration string with ms, s, m, and h (leaving a unit out if it would be 0)
 */
type DurationString = string;

type UserUpdateData = { lastUserFetch: TimeString, updatesSinceLastFetch: MangaInfo[] };

type UpdateNoUser = { state: 'no-user' };
type UpdateError = { state: 'error' };

type UpdateUnknownBase = { state: 'unknown' };
type UpdateUnknown = UpdateUnknownBase | (UpdateUnknownBase & UserUpdateData);

type UpdateRunningBase = { state: 'running', start: TimeString };
type UpdateRunning = UpdateRunningBase | (UpdateRunningBase & UserUpdateData);

type UpdateEndedBase = { state: EndedUpdateCheckState, start: TimeString, end: TimeString, duration: DurationString, count?: number };
type UpdateEnded = UpdateEndedBase | (UpdateEndedBase & UserUpdateData);

type UpdateData = UpdateNoUser | UpdateError | UpdateUnknown | UpdateRunning | UpdateEnded;



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
async function getUserUpdateData(userId: string | undefined): Promise<UpdateData> {
  try {
    const user = getUser(userId);
    if(!userId || !user) {
      return { state: 'no-user' };
    }
    let userData: UserUpdateData | EmptyObject = {};
    const lastUserCheck: number = await getLastUserCheck(userId);
    if(lastUserCheck > 0) {
      const lastUserFetch: TimeString = formatEpoch(lastUserCheck);
      const updatesSinceLastFetch: MangaInfo[] = await getUserUpdates(userId, lastUserCheck - Duration.HOURS(6));
      userData = { lastUserFetch, updatesSinceLastFetch };
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
    const count: number | undefined = user.isAdmin ? updateCount : undefined;
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

app.get('/last-update-check', async (req: Request, res: Response) => {
  // const pjson: (data: UpdateData) => void = prettyJsonResponse(res);
  const render = (data: UpdateData) => { res.render('update-check', { data }); };
  const userId: string | undefined = req.query.userId as string | undefined;
  render(await getUserUpdateData(userId));
});

function mapForJson(data: UpdateData): Dictionary<any> {
  if('updatesSinceLastFetch' in data) {
    const value: MangaInfo[] = data.updatesSinceLastFetch;
    return { ...data, updatesSinceLastFetch: Array.isArray(value) ? value.length : 0 };
  }
  return data;
}

app.get('/last-update-check.json', async (req: Request, res: Response) => {
  const pjson = prettyJsonResponse(res);
  const userId: string | undefined = req.query.userId as string | undefined;
  pjson(mapForJson(await getUserUpdateData(userId)));
});

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
    .thenDo(shutdownClient)
    .thenLogIf('Shutdown complete', !noStartStopLogs)
    .thenExit();
}

start();
