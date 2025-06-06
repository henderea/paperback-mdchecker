import type { Socket } from 'node:net';

import type { MangaTitleCheckInfo, UserPushUpdateResult } from 'lib/db';

import { updateSchedule, titleUpdateSchedule, deepCheckSchedule, noStartStopLogs, pushoverAppToken } from 'lib/env';

import fs from 'node:fs';

import schedule from 'node-schedule';
import got from 'got';
import { decode as decodeHTMLEntity } from 'html-entities';

import ipc from 'node-ipc';

import { shutdownClient, getMangaIdsForQuery, getTitleCheckMangaIds, getDeepCheckMangaIds, getLatestUpdate, updateMangaRecordsForQuery, addUpdateCheck, updateCompletedUpdateCheck, addTitleCheck, updateCompletedTitleCheck, addDeepCheck, updateInProgressDeepCheck, updateCompletedDeepCheck, updateMangaTitles, addFailedTitles, cleanFailedTitles, listUserPushUpdates, updateMangaRecordsForDeepQuery } from 'lib/db';

import { URLBuilder } from 'lib/UrlBuilder';

import { shutdownHandler } from 'lib/ShutdownHandler';

import { Duration, catchVoidError, ensureInt, formatDuration, timeout, nullIfEmpty } from 'lib/utils';
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

async function findUpdatedManga(mangaIds: string[], latestUpdate: number): Promise<{ updatedManga: string[] | number | false, hitPageFetchLimit: boolean }> {
  try {
    let offset: number = 0;
    let loadNextPage: boolean = true;
    let hitPageFetchLimit: boolean = false;
    const updatedManga: string[] = [];
    const time: Date = new Date(latestUpdate);
    const updatedAt: string = time.toISOString().split('.')[0];

    while(loadNextPage) {
      const url: string = new URLBuilder(MANGADEX_API)
        .addPathComponent('chapter')
        .addQueryParameter('limit', PAGE_SIZE)
        .addQueryParameter('offset', offset)
        .addQueryParameter('publishAtSince', updatedAt)
        .addQueryParameter('order', { 'publishAt': 'desc' })
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
        const mangaId: string = chapter.relationships.filter((x: any) => x.type == 'manga')[0]?.id;

        if(pages > 0 && mangaIds.includes(mangaId) && !updatedManga.includes(mangaId)) {
          updatedManga.push(mangaId);
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

let queryingUpdates: boolean = false;

async function queryUpdates(): Promise<number | false> {
  if(queryingUpdates) {
    console.log('Already doing update check');
    return false;
  }
  queryingUpdates = true;
  const epoch: number = Date.now();
  try {
    await addUpdateCheck(epoch);
    const mangaIds: string[] | null = await getMangaIdsForQuery(epoch - Duration.WEEK);
    if(!mangaIds) { // no manga fetched by the app recently
      await updateCompletedUpdateCheck(epoch, Date.now(), -1, false);
      queryingUpdates = false;
      return -1;
    }
    const latestUpdate: number = await determineLatestUpdate(epoch);
    const { updatedManga, hitPageFetchLimit } = await findUpdatedManga(mangaIds, latestUpdate);
    if(updatedManga === false) { // unknown error
      await updateCompletedUpdateCheck(epoch, Date.now(), -2, hitPageFetchLimit);
      queryingUpdates = false;
      return -2;
    }
    if(typeof updatedManga == 'number') { // failure status code
      if(updatedManga === 503) { // service unavailable (MD probably down)
        console.log('Got status code 503 (service unavailable) during update check');
        await updateCompletedUpdateCheck(epoch, Date.now(), -3, hitPageFetchLimit);
        queryingUpdates = false;
        return -3;
      } else { // other failure status code
        console.log(`Got status code ${updatedManga} during update check`);
        await updateCompletedUpdateCheck(epoch, Date.now(), -2, hitPageFetchLimit);
        queryingUpdates = false;
        return -2;
      }
    }
    if(!updatedManga || updatedManga.length == 0) { // no updates found
      await updateCompletedUpdateCheck(epoch, Date.now(), 0, hitPageFetchLimit);
      queryingUpdates = false;
      return 0;
    }
    await updateMangaRecordsForQuery(updatedManga, epoch);
    await updateCompletedUpdateCheck(epoch, Date.now(), updatedManga.length, hitPageFetchLimit);
    await sendUserUpdatesPush(epoch);
    queryingUpdates = false;
    return updatedManga.length;
  } catch (e) {
    console.error('Encountered error fetching updates', e);
    await catchVoidError(updateCompletedUpdateCheck(epoch, Date.now(), -2, false), 'Encountered error updating update check result');
    queryingUpdates = false;
    return -2;
  }
}

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
      const titles = <string[]>([...Object.values(mangaDetails.title), ...mangaDetails.altTitles.flatMap((x: never) => Object.values(x))].map((x: string) => decodeHTMLEntity(x)).filter((x) => x));
      const title = titles.find((t) => /[a-zA-Z]/.test(t)) ?? titles[0] ?? null;
      const status: string = mangaDetails.status;
      const lastVolume: string | null = nullIfEmpty(mangaDetails.lastVolume);
      const lastChapter: string | null = nullIfEmpty(mangaDetails.lastChapter);
      // const title = decodeHTMLEntity(mangaDetails.title.en ?? mangaDetails.altTitles.map((x: any) => x.en ?? Object.values(x).find((v) => v !== undefined)).find((t: any) => t !== undefined)) ?? null;
      mangas.push({ id, title, status, lastVolume, lastChapter });
    }
    return mangas;
  } catch (e) {
    console.error('Encountered error during getMangaInfo', e);
    return mangaIds.map((id) => ({ id, title: null, status: null, lastVolume: null, lastChapter: null }));
  }
}

let queryingTitles: boolean = false;

async function queryTitles(): Promise<number | false> {
  if(queryingTitles) {
    console.log('Already doing title check');
    return false;
  }
  queryingTitles = true;
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
          const fetchedIds: string[] = mangas.map((m) => m.id);
          const missingIds: string[] = mangaIds.filter((m) => !fetchedIds.includes(m));
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
      queryingTitles = false;
      return mangas.length;
    } else {
      await updateCompletedTitleCheck(epoch, Date.now(), -1);
      queryingTitles = false;
      return -1;
    }
  } catch (e) {
    console.error(`Encountered error fetching titles after ${formatDuration(Date.now() - epoch)}`, e);
    await catchVoidError(updateCompletedTitleCheck(epoch, Date.now(), -2), 'Encountered error updating title check result');
    queryingTitles = false;
    return -2;
  }
}

async function findUpdatedMangaDeep(epoch: number, statusHandler: (cur: number, total: number) => void): Promise<{ updatedManga: string[] | number | false, checkedManga: [string, number][] }> {
  try {
    const updatedManga: string[] = [];
    const mangas: [string, number, number, number][] | null = await getDeepCheckMangaIds(DEEP_CHECK_LIMIT, epoch - Duration.DAYS(7), epoch - Duration.DAY + Duration.MINUTE);
    const checkedManga: [string, number][] = [];
    if(!mangas || mangas.length == 0) { return { updatedManga, checkedManga }; }

    let counter: number = 0;

    for(const [mangaId, lastUpdate, lastDeepCheck, lastDeepCheckFind] of mangas) {
      if(counter > 0 && counter % DEEP_CHECK_REFRESH_COUNT == 0) {
        await updateInProgressDeepCheck(epoch, checkedManga.length);
        statusHandler(counter, mangas.length);
      }
      updateInProgressDeepCheck(epoch, checkedManga.length);
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
        checkedManga.push([mangaId, lastDeepCheckFind]);
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
        checkedManga.push([mangaId, lastDeepCheckFind]);
        continue;
      }

      const chapter = json.data[0];
      const pages: number = Number(chapter.attributes.pages);
      const publishAt: number = new Date(chapter.attributes.publishAt).getTime();
      checkedManga.push([mangaId, pages > 0 ? publishAt : lastDeepCheckFind]);
      const minPublish: number = lastUpdate <= lastDeepCheck ? lastDeepCheckFind : lastUpdate;

      if(pages > 0 && publishAt > minPublish && !updatedManga.includes(mangaId)) {
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

let queryingUpdatesDeep: boolean = false;

async function queryUpdatesDeep(statusHandler: (cur: number, total: number) => void = () => {}): Promise<false | number> {
  if(queryingUpdatesDeep) {
    console.log('Already doing deep update check');
    return false;
  }
  queryingUpdatesDeep = true;
  const epoch: number = Date.now();
  try {
    await addDeepCheck(epoch);
    const { updatedManga, checkedManga } = await findUpdatedMangaDeep(epoch, statusHandler);
    if(!checkedManga || checkedManga.length == 0) { // no manga to check
      await updateCompletedDeepCheck(epoch, Date.now(), -1, 0);
      queryingUpdatesDeep = false;
      return -1;
    }
    if(updatedManga === false) { // unknown error
      await updateCompletedDeepCheck(epoch, Date.now(), -2, -1);
      queryingUpdatesDeep = false;
      return -2;
    }
    if(typeof updatedManga == 'number') { // failure status code
      if(updatedManga === 503) { // service unavailable (MD probably down)
        console.log('Got status code 503 (service unavailable) during deep update check');
        await updateCompletedDeepCheck(epoch, Date.now(), -3, -1);
        queryingUpdatesDeep = false;
        return -3;
      } else { // other failure status code
        console.log(`Got status code ${updatedManga} during deep update check`);
        await updateCompletedDeepCheck(epoch, Date.now(), -2, -1);
        queryingUpdatesDeep = false;
        return -2;
      }
    }
    await updateMangaRecordsForDeepQuery(checkedManga, epoch);
    if(!updatedManga || updatedManga.length == 0) { // no updates found
      await updateCompletedDeepCheck(epoch, Date.now(), 0, checkedManga.length);
      queryingUpdatesDeep = false;
      return checkedManga.length;
    }
    await updateMangaRecordsForQuery(updatedManga, epoch);
    await updateCompletedDeepCheck(epoch, Date.now(), updatedManga.length, checkedManga.length);
    await sendUserUpdatesPush(epoch);
    queryingUpdatesDeep = false;
    return checkedManga.length;
  } catch (e) {
    console.error('Encountered error deep fetching updates', e);
    await catchVoidError(updateCompletedDeepCheck(epoch, Date.now(), -2, -1), 'Encountered error updating deep check result');
    queryingUpdatesDeep = false;
    return -2;
  }
}

schedule.scheduleJob(updateSchedule, () => { queryUpdates(); });
schedule.scheduleJob(titleUpdateSchedule, () => { queryTitles(); });
schedule.scheduleJob(deepCheckSchedule, () => { queryUpdatesDeep(); });

ipc.config.id = 'mdcUpdateChecker';
ipc.config.retry = 1500;
ipc.config.sync = false;
ipc.config.silent = true;
// ipc.config.logDepth = 1;
// ipc.config.unlink = false;
ipc.config.logInColor = false;
ipc.config.writableAll = true;
ipc.config.readableAll = true;

ipc.serve(() => {
  // console.log(`IPC started up (${process.pid})`);
  ipc.server.on('error', (e) => {
    console.error('Encountered error setting up IPC', e);
  }).on('trigger', async (command: string, socket: Socket) => {
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
  });
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
})();

shutdownHandler()
  .logIf(`SIGINT signal received (${process.pid}); shutting down`, !noStartStopLogs)
  .thenDo(ipc.server.stop)
  .thenDo(schedule.gracefulShutdown)
  .thenDo(shutdownClient)
  .thenLogIf(`Shutdown complete (${process.pid})`, !noStartStopLogs)
  .thenExit(0);
