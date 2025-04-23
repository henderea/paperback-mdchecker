import type { MangaInfo, UserPushUpdateResult } from 'lib/db';

import { updateSchedule, titleUpdateSchedule, deepCheckSchedule, noStartStopLogs, pushoverAppToken } from 'lib/env';

import schedule from 'node-schedule';
import got from 'got';
import { decode as decodeHTMLEntity } from 'html-entities';

import { shutdownClient, getMangaIdsForQuery, getTitleCheckMangaIds, getDeepCheckMangaIds, getLatestUpdate, updateMangaRecordsForQuery, addUpdateCheck, updateCompletedUpdateCheck, addDeepCheck, updateCompletedDeepCheck, updateMangaTitles, addFailedTitles, cleanFailedTitles, listUserPushUpdates, updateMangaRecordsForDeepQuery } from 'lib/db';

import { URLBuilder } from 'lib/UrlBuilder';

import { shutdownHandler } from 'lib/ShutdownHandler';

import { Duration, catchVoidError, ensureInt, formatDuration, timeout } from 'lib/utils';
import { Pushover } from 'lib/Pushover';

const MANGADEX_DOMAIN: string = 'https://mangadex.org';
const MANGADEX_API: string = 'https://api.mangadex.org';

const MAX_REQUESTS: number = 100;
const PAGE_SIZE: number = 100;

const CONTENT_RATINGS: string[] = ['safe', 'suggestive', 'erotica', 'pornographic'];

const DEEP_CHECK_LIMIT: number = 400;
const DEEP_CHECK_PAUSE_COUNT: number = 5;
const DEEP_CHECK_PAUSE_MILLIS: number = 500;

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

async function queryUpdates(): Promise<void> {
  const epoch: number = Date.now();
  try {
    await addUpdateCheck(epoch);
    const mangaIds: string[] | null = await getMangaIdsForQuery(epoch - Duration.WEEK);
    if(!mangaIds) { // no manga fetched by the app recently
      await updateCompletedUpdateCheck(epoch, Date.now(), -1, false);
      return;
    }
    const latestUpdate: number = await determineLatestUpdate(epoch);
    const { updatedManga, hitPageFetchLimit } = await findUpdatedManga(mangaIds, latestUpdate);
    if(updatedManga === false) { // unknown error
      await updateCompletedUpdateCheck(epoch, Date.now(), -2, hitPageFetchLimit);
      return;
    }
    if(typeof updatedManga == 'number') { // failure status code
      if(updatedManga === 503) { // service unavailable (MD probably down)
        console.log('Got status code 503 (service unavailable) during update check');
        await updateCompletedUpdateCheck(epoch, Date.now(), -3, hitPageFetchLimit);
      } else { // other failure status code
        console.log(`Got status code ${updatedManga} during update check`);
        await updateCompletedUpdateCheck(epoch, Date.now(), -2, hitPageFetchLimit);
      }
      return;
    }
    if(!updatedManga || updatedManga.length == 0) { // no updates found
      await updateCompletedUpdateCheck(epoch, Date.now(), 0, hitPageFetchLimit);
      return;
    }
    await updateMangaRecordsForQuery(updatedManga, epoch);
    await updateCompletedUpdateCheck(epoch, Date.now(), updatedManga.length, hitPageFetchLimit);
    await sendUserUpdatesPush(epoch);
  } catch (e) {
    console.error('Encountered error fetching updates', e);
    catchVoidError(updateCompletedUpdateCheck(epoch, Date.now(), -2, false), 'Encountered error updating update check result');
  }
}

async function getMangaInfo(mangaIds: string[]): Promise<MangaInfo[]> {
  if(mangaIds.length > PAGE_SIZE) {
    mangaIds = mangaIds.slice(0, PAGE_SIZE);
  }
  try {
    const mangas: MangaInfo[] = [];
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
      // const title = decodeHTMLEntity(mangaDetails.title.en ?? mangaDetails.altTitles.map((x: any) => x.en ?? Object.values(x).find((v) => v !== undefined)).find((t: any) => t !== undefined)) ?? null;
      mangas.push({ id, title });
    }
    return mangas;
  } catch (e) {
    console.error('Encountered error during getMangaInfo', e);
    return mangaIds.map((id) => ({ id, title: null }));
  }
}

async function queryTitles(): Promise<void> {
  const start: number = Date.now();
  try {
    const mangaIds: string[] | null = await getTitleCheckMangaIds(PAGE_SIZE, start - Duration.DAYS(2));
    if(mangaIds && mangaIds.length > 0) {
      const mangas: MangaInfo[] = await getMangaInfo(mangaIds);
      if(mangas && mangas.length > 0) {
        await updateMangaTitles(mangas, start);
        // console.log(`Finished title update for ${mangas?.length ?? 0} titles in ${formatDuration(Date.now() - start)}`);
        await cleanFailedTitles(mangaIds);
        if(mangas.length < mangaIds.length && mangas.length < PAGE_SIZE) {
          const fetchedIds: string[] = mangas.map((m) => m.id);
          const missingIds: string[] = mangaIds.filter((m) => !fetchedIds.includes(m));
          const missingCount: number = missingIds.length;
          if(missingCount > 0) {
            console.log(`Failed title update on ${missingCount} title${missingCount == 1 ? '' : 's'}:\n${missingIds.join('\n')}`);
            await addFailedTitles(missingIds, start);
          }
        }
      } else {
        console.log(`No titles were able to be fetched after ${formatDuration(Date.now() - start)}`);
        console.log(`Failed title update on ${mangaIds.length} title${mangaIds.length == 1 ? '' : 's'}:\n${mangaIds.join('\n')}`);
        await cleanFailedTitles(mangaIds);
        await addFailedTitles(mangaIds, start);
      }
    } else {
      // console.log(`No titles found to update after ${formatDuration(Date.now() - start)}`);
    }
  } catch (e) {
    console.error(`Encountered error fetching titles after ${formatDuration(Date.now() - start)}`, e);
  }
}

async function findUpdatedMangaDeep(epoch: number): Promise<{ updatedManga: string[] | number | false, mangaIds: string[] }> {
  try {
    const updatedManga: string[] = [];
    const mangas: [string, number, number][] | null = await getDeepCheckMangaIds(DEEP_CHECK_LIMIT, epoch - Duration.DAYS(7), epoch - Duration.DAY + Duration.MINUTE);
    const mangaIds: string[] = mangas?.map((m: [string, number, number]) => m[0]) ?? [];
    if(!mangas || mangas.length == 0) { return { updatedManga, mangaIds }; }

    let counter: number = 0;

    for(const [mangaId, lastUpdate, lastDeepCheck] of mangas) {
      if(counter > 0 && counter % DEEP_CHECK_PAUSE_COUNT == 0) {
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
        continue;
      }

      const chapter = json.data[0];
      const pages: number = Number(chapter.attributes.pages);
      const publishAt: number = new Date(chapter.attributes.publishAt).getTime();

      if(pages > 0 && publishAt >= lastUpdate && publishAt >= lastDeepCheck && !updatedManga.includes(mangaId)) {
        updatedManga.push(mangaId);
      }
    }

    return { updatedManga, mangaIds };
  } catch (e) {
    const rv: number | false = (e as any).response?.statusCode ?? false;
    if(!rv) {
      console.error('Encountered error deep fetching updates', e);
    }
    return { updatedManga: rv, mangaIds: [] };
  }
}

async function queryUpdatesDeep(): Promise<void> {
  const epoch: number = Date.now();
  try {
    await addDeepCheck(epoch);
    const { updatedManga, mangaIds } = await findUpdatedMangaDeep(epoch);
    if(!mangaIds || mangaIds.length == 0) { // no manga to check
      await updateCompletedDeepCheck(epoch, Date.now(), -1);
      return;
    }
    if(updatedManga === false) { // unknown error
      await updateCompletedDeepCheck(epoch, Date.now(), -2);
      return;
    }
    if(typeof updatedManga == 'number') { // failure status code
      if(updatedManga === 503) { // service unavailable (MD probably down)
        console.log('Got status code 503 (service unavailable) during deep update check');
        await updateCompletedDeepCheck(epoch, Date.now(), -3);
      } else { // other failure status code
        console.log(`Got status code ${updatedManga} during deep update check`);
        await updateCompletedDeepCheck(epoch, Date.now(), -2);
      }
      return;
    }
    await updateMangaRecordsForDeepQuery(mangaIds, epoch);
    if(!updatedManga || updatedManga.length == 0) { // no updates found
      await updateCompletedDeepCheck(epoch, Date.now(), 0);
      return;
    }
    await updateMangaRecordsForQuery(updatedManga, epoch);
    await updateCompletedDeepCheck(epoch, Date.now(), updatedManga.length);
    await sendUserUpdatesPush(epoch);
  } catch (e) {
    console.error('Encountered error deep fetching updates', e);
    await updateCompletedDeepCheck(epoch, Date.now(), -2);
  }
}

schedule.scheduleJob(updateSchedule, queryUpdates);
schedule.scheduleJob(titleUpdateSchedule, queryTitles);
schedule.scheduleJob(deepCheckSchedule, queryUpdatesDeep);

shutdownHandler()
  .logIf('SIGINT signal received; shutting down', !noStartStopLogs)
  .thenDo(schedule.gracefulShutdown)
  .thenDo(shutdownClient)
  .thenLogIf('Shutdown complete', !noStartStopLogs)
  .thenExit(0);
