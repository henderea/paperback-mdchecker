import type { Socket } from 'node:net';

import type { MangaTitleCheckInfo, UserPushUpdateResult, MangaQuerySubmission, MangaDeepQuerySubmission } from 'lib/db';

import { updateSchedule, titleUpdateSchedule, deepCheckSchedule, noStartStopLogs, pushoverAppToken } from 'lib/env';

import fs from 'node:fs';

import schedule from 'node-schedule';
import got from 'got';
import { decode as decodeHTMLEntity } from 'html-entities';

import ipc from 'node-ipc';

import { shutdownClient, getMangaIdsForQuery, getTitleCheckMangaIds, getDeepCheckMangaIds, getLatestUpdate, updateMangaRecordsForQuery, addUpdateCheck, updateCompletedUpdateCheck, addTitleCheck, updateCompletedTitleCheck, addDeepCheck, updateInProgressDeepCheck, updateCompletedDeepCheck, updateMangaTitles, addFailedTitles, cleanFailedTitles, listUserPushUpdates, updateMangaRecordsForDeepQuery } from 'lib/db';

import { URLBuilder } from 'lib/UrlBuilder';

import { shutdownHandler } from 'lib/ShutdownHandler';

import { Duration, catchVoidError, ensureInt, formatDuration, timeout, nullIfEmpty, _ } from 'lib/utils';
import { Pushover } from 'lib/Pushover';

const MANGADEX_DOMAIN: string = 'https://mangadex.org';
const MANGADEX_API: string = 'https://api.mangadex.org';

const MAX_REQUESTS: number = 100;
const PAGE_SIZE: number = 100;

const CONTENT_RATINGS: string[] = ['safe', 'suggestive', 'erotica', 'pornographic'];

const DEEP_CHECK_LIMIT: number = 200;
const DEEP_CHECK_REFRESH_COUNT: number = 10;
const DEEP_CHECK_PAUSE_COUNT: number = 5;
const DEEP_CHECK_PAUSE_MILLIS: number = 100;

const DEEP_CHECK_PAUSE_ENABLED: boolean = DEEP_CHECK_PAUSE_COUNT > 0 && DEEP_CHECK_PAUSE_MILLIS > 0;

class SingleRunner<H extends (...args: any[]) => Promise<number> = () => Promise<number>> {
  private readonly _rejectionMessage: string;
  private readonly _handler: H;
  private _running: boolean = false;

  private constructor(rejectionMessage: string, handler: H) {
    this._rejectionMessage = rejectionMessage;
    this._handler = handler;
  }

  private get rejectionMessage(): string { return this._rejectionMessage; }
  private get handler(): H { return this._handler; }
  get running(): boolean { return this._running; }

  async run(...args: Parameters<H>): Promise<number | false> {
    if(this.running) {
      console.log(this.rejectionMessage);
      return false;
    }
    this._running = true;
    try {
      return await this.handler(...args);
    } finally {
      this._running = false;
    }
  }

  static wrap<H extends (...args: any[]) => Promise<number> = () => Promise<number>>(rejectionMessage: string, handler: H): (...args: Parameters<H>) => Promise<number | false> {
    const runner: SingleRunner<H> = new SingleRunner(rejectionMessage, handler);
    return runner.run.bind(runner);
  }
}

async function findUpdatedManga(mangaIds: string[], latestUpdate: number): Promise<{ updatedManga: MangaQuerySubmission[] | number | false, hitPageFetchLimit: boolean }> {
  try {
    let offset: number = 0;
    let loadNextPage: boolean = true;
    let hitPageFetchLimit: boolean = false;
    const updatedManga: MangaQuerySubmission[] = [];
    const time: Date = new Date(latestUpdate);
    const updatedAt: string = time.toISOString().split('.')[0];

    while(loadNextPage) {
      const url: string = new URLBuilder(MANGADEX_API)
        .addPathComponent('chapter')
        .addQueryParameter('limit', PAGE_SIZE)
        .addQueryParameter('offset', offset)
        .addQueryParameter('publishAtSince', updatedAt)
        .addQueryParameter('order', { 'publishAt': 'desc' })
        .addQueryParameter('includes', ['scanlation_group'])
        .addQueryParameter('translatedLanguage', ['en'])
        .addQueryParameter('includeFutureUpdates', '0')
        .addQueryParameter('contentRating', CONTENT_RATINGS)
        .buildUrl();

      const response = await got(url, {
        headers: {
          referer: `${MANGADEX_DOMAIN}/`
        },
        decompress: true
      });

      // If we have no content, there are no updates available
      if(response.statusCode == 204) {
        console.log('Response was 204');
        return { updatedManga, hitPageFetchLimit };
      }

      const json = (typeof response.body) === 'string' ? JSON.parse(response.body) : response.body;
      // console.log(`status code: ${response.statusCode}`);
      // console.log('response:', json);

      if(json.data === undefined) {
        throw new Error(`Failed to parse JSON results for filterUpdatedManga using the date ${updatedAt} and the offset ${offset}`);
      }

      for(const chapter of json.data) {
        const pages: number = Number(chapter.attributes.pages);
        const mangaId: string = _.filter(chapter.relationships, ['type', 'manga'])[0]?.id;
        const latestGroup: string | null = nullIfEmpty(_.map(_.filter(chapter.relationships, ['type', 'scanlation_group']), 'attributes.name').join('; '));

        if(pages > 0 && mangaIds.includes(mangaId) && !_.some(updatedManga, ['mangaId', mangaId])) {
          updatedManga.push({ mangaId, latestGroup });
        }
      }

      offset = offset + PAGE_SIZE;
      if(json.total <= offset) {
        loadNextPage = false;
      } else if(offset >= (PAGE_SIZE * MAX_REQUESTS)) {
        console.log('Hit page fetch limit');
        hitPageFetchLimit = true;
        loadNextPage = false;
      }
    }

    return { updatedManga, hitPageFetchLimit };
  } catch (e) {
    const rv: number | false = (e as any).response?.statusCode ?? false;
    if(!rv) {
      console.error('Encountered error fetching updates', e);
    }
    return { updatedManga: rv, hitPageFetchLimit: false };
  }
}

async function determineLatestUpdate(epoch: number): Promise<number> {
  const latestUpdate: number = await getLatestUpdate();
  if(latestUpdate <= 0) { // if we can't figure out the last update timestamp, look 1 day back
    return epoch - Duration.DAY;
  }
  return latestUpdate - Duration.MINUTE;
}

async function sendUserUpdatesPush(epoch: number): Promise<void> {
  const userUpdates: UserPushUpdateResult[] | null = await listUserPushUpdates(epoch);
  if(!userUpdates) { return; }
  for(const u of userUpdates) {
    try {
      const appToken: string | null = u.pushover_app_token_override || pushoverAppToken;
      if(appToken) {
        const count: number = ensureInt(u.count);
        await new Pushover(appToken, u.pushover_token).message(`Found ${count} new manga update${count == 1 ? '' : 's'}`).send();
      }
    } catch (e) {
      console.error(`Encountered issue sending updates push for user ${u.user_id}`, e);
    }
  }
}

const queryUpdates: () => Promise<number | false> = SingleRunner.wrap('Already doing update check', async function queryUpdates(): Promise<number> {
  const epoch: number = Date.now();
  try {
    await addUpdateCheck(epoch);
    const mangaIds: string[] | null = await getMangaIdsForQuery(epoch - Duration.WEEK);
    if(!mangaIds) { // no manga fetched by the app recently
      await updateCompletedUpdateCheck(epoch, Date.now(), -1, false);
      return -1;
    }
    const latestUpdate: number = await determineLatestUpdate(epoch);
    const { updatedManga, hitPageFetchLimit } = await findUpdatedManga(mangaIds, latestUpdate);
    if(updatedManga === false) { // unknown error
      await updateCompletedUpdateCheck(epoch, Date.now(), -2, hitPageFetchLimit);
      return -2;
    }
    if(typeof updatedManga == 'number') { // failure status code
      if(updatedManga === 503) { // service unavailable (MD probably down)
        console.log('Got status code 503 (service unavailable) during update check');
        await updateCompletedUpdateCheck(epoch, Date.now(), -3, hitPageFetchLimit);
        return -3;
      } else { // other failure status code
        console.log(`Got status code ${updatedManga} during update check`);
        await updateCompletedUpdateCheck(epoch, Date.now(), -2, hitPageFetchLimit);
        return -2;
      }
    }
    if(!updatedManga || updatedManga.length == 0) { // no updates found
      await updateCompletedUpdateCheck(epoch, Date.now(), 0, hitPageFetchLimit);
      return 0;
    }
    await updateMangaRecordsForQuery(updatedManga, epoch);
    await updateCompletedUpdateCheck(epoch, Date.now(), updatedManga.length, hitPageFetchLimit);
    await sendUserUpdatesPush(epoch);
    return updatedManga.length;
  } catch (e) {
    console.error('Encountered error fetching updates', e);
    await catchVoidError(updateCompletedUpdateCheck(epoch, Date.now(), -2, false), 'Encountered error updating update check result');
    return -2;
  }
});

async function getMangaTitleCheckInfo(mangaIds: string[]): Promise<MangaTitleCheckInfo[]> {
  if(mangaIds.length > PAGE_SIZE) {
    mangaIds = mangaIds.slice(0, PAGE_SIZE);
  }
  try {
    const mangas: MangaTitleCheckInfo[] = [];
    const url: string = new URLBuilder(MANGADEX_API)
      .addPathComponent('manga')
      .addQueryParameter('limit', PAGE_SIZE)
      .addQueryParameter('ids', mangaIds)
      .addQueryParameter('contentRating', CONTENT_RATINGS)
      .buildUrl();

    const response = await got(url, {
      headers: {
        referer: `${MANGADEX_DOMAIN}/`
      },
      decompress: true
    });

    const json = (typeof response.body) === 'string' ? JSON.parse(response.body) : response.body;

    if(json.data === undefined) {
      // Log this, no need to throw.
      console.log(`Failed to parse JSON results for getMangaInfo`);
      return mangas;
    }

    for(const manga of json.data) {
      const id = manga.id;
      const mangaDetails = manga.attributes;
      const titles: string[] = _.map(_.compact<string>([...Object.values(mangaDetails.title), ...mangaDetails.altTitles.flatMap((x: never) => Object.values(x))]), (x: string) => decodeHTMLEntity(x));
      const title: string | null = titles.find((t) => /[a-zA-Z]/.test(t)) ?? titles[0] ?? null;
      const status: string = mangaDetails.status;
      const lastVolume: string | null = nullIfEmpty(mangaDetails.lastVolume);
      const lastChapter: string | null = nullIfEmpty(mangaDetails.lastChapter);
      const contentRating: string | null = nullIfEmpty(mangaDetails.contentRating);
      // const title = decodeHTMLEntity(mangaDetails.title.en ?? mangaDetails.altTitles.map((x: any) => x.en ?? Object.values(x).find((v) => v !== undefined)).find((t: any) => t !== undefined)) ?? null;
      mangas.push({ id, title, status, lastVolume, lastChapter, contentRating });
    }
    return mangas;
  } catch (e) {
    console.error('Encountered error during getMangaInfo', e);
    return _.map(mangaIds, (id) => ({ id, title: null, status: null, lastVolume: null, lastChapter: null, contentRating: null }));
  }
}

const queryTitles: () => Promise<number | false> = SingleRunner.wrap('Already doing title check', async function queryTitles(): Promise<number> {
  const epoch: number = Date.now();
  try {
    await addTitleCheck(epoch);
    const mangaIds: string[] | null = await getTitleCheckMangaIds(PAGE_SIZE, epoch - Duration.DAYS(2));
    if(mangaIds && mangaIds.length > 0) {
      const mangas: MangaTitleCheckInfo[] = await getMangaTitleCheckInfo(mangaIds);
      if(mangas && mangas.length > 0) {
        await updateMangaTitles(mangas, epoch);
        // console.log(`Finished title update for ${mangas?.length ?? 0} titles in ${formatDuration(Date.now() - start)}`);
        await cleanFailedTitles(mangaIds);
        if(mangas.length < mangaIds.length && mangas.length < PAGE_SIZE) {
          const fetchedIds: string[] = _.map(mangas, 'id');
          const missingIds: string[] = _.difference(mangaIds, fetchedIds);
          const missingCount: number = missingIds.length;
          if(missingCount > 0) {
            console.log(`Failed title update on ${missingCount} title${missingCount == 1 ? '' : 's'}:\n${missingIds.join('\n')}`);
            await addFailedTitles(missingIds, epoch);
          }
        }
      } else {
        console.log(`No titles were able to be fetched after ${formatDuration(Date.now() - epoch)}`);
        console.log(`Failed title update on ${mangaIds.length} title${mangaIds.length == 1 ? '' : 's'}:\n${mangaIds.join('\n')}`);
        await cleanFailedTitles(mangaIds);
        await addFailedTitles(mangaIds, epoch);
      }
      await updateCompletedTitleCheck(epoch, Date.now(), mangas.length);
      return mangas.length;
    } else {
      await updateCompletedTitleCheck(epoch, Date.now(), -1);
      return -1;
    }
  } catch (e) {
    console.error(`Encountered error fetching titles after ${formatDuration(Date.now() - epoch)}`, e);
    await catchVoidError(updateCompletedTitleCheck(epoch, Date.now(), -2), 'Encountered error updating title check result');
    return -2;
  }
});

async function findUpdatedMangaDeep(epoch: number, statusHandler: (cur: number, total: number) => void): Promise<{ updatedManga: string[] | number | false, checkedManga: MangaDeepQuerySubmission[] }> {
  try {
    const updatedManga: string[] = [];
    const mangas: Array<[string, number, number, number]> | null = await getDeepCheckMangaIds(DEEP_CHECK_LIMIT, epoch - Duration.DAYS(7), epoch - Duration.DAY + Duration.MINUTE);
    const checkedManga: MangaDeepQuerySubmission[] = [];
    if(!mangas || mangas.length == 0) { return { updatedManga, checkedManga }; }

    const latestUpdate: number = await getLatestUpdate();

    const regularCheckThreshold: number = latestUpdate <= 0 ? 0 : (latestUpdate - Duration.SECONDS(55));

    let counter: number = 0;

    for(const [mangaId, lastUpdate, lastDeepCheck, lastDeepCheckFind] of mangas) {
      if(counter > 0 && counter % DEEP_CHECK_REFRESH_COUNT == 0) {
        await updateInProgressDeepCheck(epoch, checkedManga.length);
        statusHandler(counter, mangas.length);
      }
      void updateInProgressDeepCheck(epoch, checkedManga.length);
      if(DEEP_CHECK_PAUSE_ENABLED && counter > 0 && counter % DEEP_CHECK_PAUSE_COUNT == 0) {
        await timeout(DEEP_CHECK_PAUSE_MILLIS);
      }

      counter++;

      const url: string = new URLBuilder(MANGADEX_API)
        .addPathComponent('chapter')
        .addQueryParameter('limit', 1)
        .addQueryParameter('manga', mangaId)
        .addQueryParameter('order', { 'publishAt': 'desc' })
        .addQueryParameter('translatedLanguage', ['en'])
        .addQueryParameter('includes', ['scanlation_group'])
        .addQueryParameter('includeFutureUpdates', '0')
        .addQueryParameter('includeEmptyPages', '0')
        .addQueryParameter('includeExternalUrl', '0')
        .addQueryParameter('contentRating', CONTENT_RATINGS)
        .buildUrl();

      const response = await got(url, {
        headers: {
          referer: `${MANGADEX_DOMAIN}/`
        },
        decompress: true
      });

      // If we have no content, there are no chapters available
      if(response.statusCode == 204) {
        checkedManga.push({ mangaId, lastDeepCheckFind, latestGroup: null, noChapters: true });
        continue;
      }

      const json = (typeof response.body) === 'string' ? JSON.parse(response.body) : response.body;
      // console.log(`status code: ${response.statusCode}`);
      // console.log('response:', json);

      if(json.data === undefined) {
        throw new Error(`Failed to parse JSON results for findUpdatedManagaDeep using the mangaId ${mangaId}`);
      }

      // no chapters
      if(!json.data || json.data.length == 0) {
        checkedManga.push({ mangaId, lastDeepCheckFind, latestGroup: null, noChapters: true });
        continue;
      }

      const chapter = json.data[0];
      const pages: number = Number(chapter.attributes.pages);
      const publishAt: number = new Date(chapter.attributes.publishAt).getTime();
      const latestGroup: string | null = nullIfEmpty(_.map(_.filter(chapter.relationships, ['type', 'scanlation_group']), 'attributes.name').join('; '));
      checkedManga.push({ mangaId, lastDeepCheckFind: pages > 0 ? publishAt : lastDeepCheckFind, latestGroup, noChapters: false });
      const minPublish: number = lastUpdate <= lastDeepCheck ? lastDeepCheckFind : lastUpdate;

      if(pages > 0 && publishAt > minPublish && (regularCheckThreshold <= 0 || publishAt <= regularCheckThreshold) && !updatedManga.includes(mangaId)) {
        updatedManga.push(mangaId);
      }
    }

    return { updatedManga, checkedManga };
  } catch (e) {
    const rv: number | false = (e as any).response?.statusCode ?? false;
    if(!rv) {
      console.error('Encountered error deep fetching updates', e);
    }
    return { updatedManga: rv, checkedManga: [] };
  }
}

const queryUpdatesDeep: (statusHandler?: (cur: number, total: number) => void) => Promise<number | false> = SingleRunner.wrap('Already doing deep update check', async function queryUpdatesDeep(statusHandler: (cur: number, total: number) => void = () => {}): Promise<number> {
  const epoch: number = Date.now();
  try {
    await addDeepCheck(epoch);
    const { updatedManga, checkedManga } = await findUpdatedMangaDeep(epoch, statusHandler);
    if(!checkedManga || checkedManga.length == 0) { // no manga to check
      await updateCompletedDeepCheck(epoch, Date.now(), -1, 0);
      return -1;
    }
    if(updatedManga === false) { // unknown error
      await updateCompletedDeepCheck(epoch, Date.now(), -2, -1);
      return -2;
    }
    if(typeof updatedManga == 'number') { // failure status code
      if(updatedManga === 503) { // service unavailable (MD probably down)
        console.log('Got status code 503 (service unavailable) during deep update check');
        await updateCompletedDeepCheck(epoch, Date.now(), -3, -1);
        return -3;
      } else { // other failure status code
        console.log(`Got status code ${updatedManga} during deep update check`);
        await updateCompletedDeepCheck(epoch, Date.now(), -2, -1);
        return -2;
      }
    }
    await updateMangaRecordsForDeepQuery(checkedManga, epoch);
    if(!updatedManga || updatedManga.length == 0) { // no updates found
      await updateCompletedDeepCheck(epoch, Date.now(), 0, checkedManga.length);
      return checkedManga.length;
    }
    await updateMangaRecordsForQuery({ mangaIds: updatedManga }, epoch);
    await updateCompletedDeepCheck(epoch, Date.now(), updatedManga.length, checkedManga.length);
    await sendUserUpdatesPush(epoch);
    return checkedManga.length;
  } catch (e) {
    console.error('Encountered error deep fetching updates', e);
    await catchVoidError(updateCompletedDeepCheck(epoch, Date.now(), -2, -1), 'Encountered error updating deep check result');
    return -2;
  }
});

schedule.scheduleJob(updateSchedule, () => void queryUpdates());
schedule.scheduleJob(titleUpdateSchedule, () => void queryTitles());
schedule.scheduleJob(deepCheckSchedule, () => void queryUpdatesDeep());

ipc.config.id = 'mdcUpdateChecker';
ipc.config.retry = 1500;
ipc.config.sync = false;
ipc.config.silent = true;
// ipc.config.logDepth = 1;
// ipc.config.unlink = false;
ipc.config.logInColor = false;
ipc.config.writableAll = true;
ipc.config.readableAll = true;

async function handleTrigger(command: string, socket: Socket): Promise<void> {
  if(command === 'title-check') {
    const rv: number | false = await queryTitles();
    if(rv === false) {
      ipc.server.emit(socket, 'already-running');
    } else if(rv === -1) {
      ipc.server.emit(socket, 'no-items');
    } else if(rv < 0) {
      ipc.server.emit(socket, 'failure', String(rv));
    } else {
      ipc.server.emit(socket, 'success', String(rv));
    }
  } else if(command === 'deep-check') {
    const rv: number | false = await queryUpdatesDeep((cur: number, total: number) => {
      const len: number = String(total).length;
      ipc.server.emit(socket, 'progress', `${String(cur).padStart(len)}/${total} (${Math.round((cur * 1000.0) / total) / 10.0}%)`);
    });
    if(rv === false) {
      ipc.server.emit(socket, 'already-running');
    } else if(rv === -1) {
      ipc.server.emit(socket, 'no-items');
    } else if(rv < 0) {
      ipc.server.emit(socket, 'failure', String(rv));
    } else {
      ipc.server.emit(socket, 'success', String(rv));
    }
  } else {
    ipc.server.emit(socket, 'unsupported');
  }
}

ipc.serve(() => {
  // console.log(`IPC started up (${process.pid})`);
  ipc.server.on('error', (e) => {
    console.error('Encountered error setting up IPC', e);
  }).on('trigger', (command: string, socket: Socket) => void handleTrigger(command, socket));
});

const ipcPath: string = ipc.config.socketRoot + ipc.config.appspace + ipc.config.id;

const MAX_TURNS = 30;

(async () => {
  let turns: number = 0;
  while(turns < MAX_TURNS) {
    turns++;
    if(fs.existsSync(ipcPath)) {
      await timeout(1000);
    } else {
      break;
    }
  }
  if(fs.existsSync(ipcPath)) {
    console.log('Done waiting; unlinking IPC');
    fs.unlinkSync(ipcPath);
  }
  ipc.server.start();
})().catch((e: any) => {
  console.log(e);
  process.exit(1);
});

shutdownHandler()
  .logIf(`SIGINT signal received (${process.pid}); shutting down`, !noStartStopLogs)
  .thenDo(() => ipc?.server?.stop())
  .thenDo(schedule.gracefulShutdown)
  .thenDo(shutdownClient)
  .thenLogIf(`Shutdown complete (${process.pid})`, !noStartStopLogs)
  .thenExit(0);
