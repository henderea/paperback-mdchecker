import type { MangaInfo } from 'lib/db';

import { updateSchedule, titleUpdateSchedule, noStartStopLogs } from 'lib/env';

import schedule from 'node-schedule';
import got from 'got';
import entities = require('entities');
import _map from 'lodash/map.js';
import _difference from 'lodash/difference.js';

import { shutdownClient, getMangaIdsForQuery, getTitleCheckMangaIds, getLatestUpdate, updateMangaRecordsForQuery, addUpdateCheck, updateCompletedUpdateCheck, updateMangaTitles } from 'lib/db';

import { URLBuilder } from 'lib/UrlBuilder';

import { shutdownHandler } from 'lib/ShutdownHandler';

import { Duration, catchVoidError, formatDuration } from 'lib/utils';

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
    await updateMangaRecordsForQuery(updatedManga, epoch);
    await updateCompletedUpdateCheck(epoch, Date.now(), updatedManga.length);
  } catch (e) {
    console.error('Encountered error fetching updates', e);
    catchVoidError(updateCompletedUpdateCheck(epoch, Date.now(), -2), 'Encountered error updating update check result');
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
      return mangas;
    }

    for(const manga of json.data) {
      const id = manga.id;
      const mangaDetails = manga.attributes;
      const title = decodeHTMLEntity(mangaDetails.title.en ?? mangaDetails.altTitles.map((x: any) => Object.values(x).find((v) => v !== undefined)).find((t: any) => t !== undefined)) ?? null;
      mangas.push({ id, title });
    }
    return mangas;
  } catch (e) {
    console.error('Encountered error during getMangaInfo', e);
    return _map(mangaIds, (id) => ({ id, title: null }));
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
        console.log(`Finished title update for ${mangas?.length ?? 0} titles in ${formatDuration(Date.now() - start)}`);
        if(mangas.length < mangaIds.length && mangas.length < PAGE_SIZE) {
          const fetchedIds: string[] = _map(mangas, 'id');
          const missingIds: string[] = _difference(mangaIds, fetchedIds);
          const missingCount: number = missingIds.length;
          if(missingCount > 0) {
            console.log(`Failed title update on ${missingCount} title${missingCount == 1 ? '' : 's'}:\n${missingIds.join('\n')}`);
          }
        }
      } else {
        console.log(`No titles were able to be fetched after ${formatDuration(Date.now() - start)}`);
        console.log(`Failed title update on ${mangaIds.length} title${mangaIds.length == 1 ? '' : 's'}:\n${mangaIds.join('\n')}`);
      }
    } else {
      // console.log(`No titles found to update after ${formatDuration(Date.now() - start)}`);
    }
  } catch (e) {
    console.error(`Encountered error fetching titles after ${formatDuration(Date.now() - start)}`, e);
  }
}

schedule.scheduleJob(updateSchedule, queryUpdates);
schedule.scheduleJob(titleUpdateSchedule, queryTitles);

shutdownHandler()
  .logIf('SIGINT signal received; shutting down', !noStartStopLogs)
  .thenDo(schedule.gracefulShutdown)
  .thenDo(shutdownClient)
  .thenLogIf('Shutdown complete', !noStartStopLogs)
  .thenExit(0);
