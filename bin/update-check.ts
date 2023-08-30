import type { MangaInfo } from 'lib/db';

import { updateSchedule, noStartStopLogs } from 'lib/env';

import schedule from 'node-schedule';
import got from 'got';
import entities = require('entities');

import { shutdownClient, getMangaIdsForQuery, getLatestUpdate, updateMangaRecordsForQuery, addUpdateCheck, updateCompletedUpdateCheck } from 'lib/db';

import { URLBuilder } from 'lib/UrlBuilder';

import { shutdownHandler } from 'lib/ShutdownHandler';

import { Duration, catchVoidError } from 'lib/utils';

const MANGADEX_DOMAIN: string = 'https://mangadex.org';
const MANGADEX_API: string = 'https://api.mangadex.org';

const MAX_REQUESTS: number = 100;
const PAGE_SIZE: number = 100;

async function findUpdatedManga(mangaIds: string[], latestUpdate: number): Promise<string[]> {
  let offset: number = 0;
  let loadNextPage: boolean = true;
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
      .buildUrl();

    const response = await got(url, {
      headers: {
        referer: `${MANGADEX_DOMAIN}/`
      }
    });

    // If we have no content, there are no updates available
    if(response.statusCode == 204) {
      console.log('Response was 204');
      return updatedManga;
    }

    const json = (typeof response.body) === 'string' ? JSON.parse(response.body) : response.body;

    if(json.data === undefined) {
      // Log this, no need to throw.
      console.log(`Failed to parse JSON results for filterUpdatedManga using the date ${updatedAt} and the offset ${offset}`);
      return updatedManga;
    }

    for(const chapter of json.data) {
      const mangaId = chapter.relationships.filter((x: any) => x.type == 'manga')[0]?.id;

      if(mangaIds.includes(mangaId) && !updatedManga.includes(mangaId)) {
        updatedManga.push(mangaId);
      }
    }

    offset = offset + PAGE_SIZE;
    if(json.total <= offset || offset >= (PAGE_SIZE * MAX_REQUESTS)) {
      loadNextPage = false;
    }
  }

  return updatedManga;
}

async function determineLatestUpdate(epoch: number): Promise<number> {
  const latestUpdate: number = await getLatestUpdate();
  if(latestUpdate <= 0) { // if we can't figure out the last update timestamp, look 1 day back
    return epoch - Duration.DAY;
  }
  return latestUpdate - Duration.MINUTE;
}

function decodeHTMLEntity(str: string | undefined): string | undefined {
  if(str == undefined) {
    return undefined;
  }
  return entities.decodeHTML(str);
}

async function getMangaInfo(mangaIds: string[]): Promise<MangaInfo[]> {
  try {
    if(mangaIds.length > PAGE_SIZE) {
      return mangaIds.map((id) => ({ id, title: null }));
    }
    const url: string = new URLBuilder(MANGADEX_API)
      .addPathComponent('manga')
      .addQueryParameter('limit', PAGE_SIZE)
      .addQueryParameter('ids', mangaIds)
      .buildUrl();

    const response = await got(url, {
      headers: {
        referer: `${MANGADEX_DOMAIN}/`
      }
    });

    const json = (typeof response.body) === 'string' ? JSON.parse(response.body) : response.body;

    if(json.data === undefined) {
      // Log this, no need to throw.
      console.log(`Failed to parse JSON results for getMangaInfo`);
      return mangaIds.map((id) => ({ id, title: null }));
    }

    const rv: MangaInfo[] = [];

    for(const manga of json.data) {
      const id = manga.id;
      const mangaDetails = manga.attributes;
      const title = decodeHTMLEntity(mangaDetails.title.en ?? mangaDetails.altTitles.map((x: any) => Object.values(x).find((v) => v !== undefined)).find((t: any) => t !== undefined)) ?? null;
      rv.push({ id, title });
    }
    return rv;
  } catch (e) {
    console.error('Encountered error during getMangaInfo', e);
    return mangaIds.map((id) => ({ id, title: null }));
  }
}

async function queryUpdates(): Promise<void> {
  const epoch: number = Date.now();
  try {
    await addUpdateCheck(epoch);
    const mangaIds: string[] | null = await getMangaIdsForQuery(epoch - Duration.WEEK);
    if(!mangaIds) { // no manga fetched by the app recently
      await updateCompletedUpdateCheck(epoch, Date.now(), -1);
      return;
    }
    const latestUpdate: number = await determineLatestUpdate(epoch);
    const updatedManga: string[] = await findUpdatedManga(mangaIds, latestUpdate);
    if(!updatedManga || updatedManga.length == 0) { // no updates found
      await updateCompletedUpdateCheck(epoch, Date.now(), 0);
      return;
    }
    await updateMangaRecordsForQuery(await getMangaInfo(updatedManga), epoch);
    await updateCompletedUpdateCheck(epoch, Date.now(), updatedManga.length);
  } catch (e) {
    console.error('Encountered error fetching updates', e);
    catchVoidError(updateCompletedUpdateCheck(epoch, Date.now(), -2), 'Encountered error updating update check result');
  }
}

schedule.scheduleJob(updateSchedule, queryUpdates);

shutdownHandler()
  .logIf('SIGINT signal received; shutting down', !noStartStopLogs)
  .thenDo(schedule.gracefulShutdown)
  .thenDo(shutdownClient)
  .thenLogIf('Shutdown complete', !noStartStopLogs)
  .thenExit(0);
