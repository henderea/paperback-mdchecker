const { updateSchedule } = require('./env');

const schedule = require('node-schedule');
const got = require('got');

const { shutdownPool, getMangaIdsForQuery, getLatestUpdate, updateMangaRecordsForQuery } = require('./db');

const { URLBuilder } = require('./UrlBuilder');

const { shutdownHandler } = require('./ShutdownHandler');

const { Duration } = require('./utils');

const MANGADEX_DOMAIN = 'https://mangadex.org';
const MANGADEX_API = 'https://api.mangadex.org';

const MAX_REQUESTS = 100;
const PAGE_SIZE = 100;

async function findUpdatedManga(mangaIds, latestUpdate) {
  let offset = 0;
  let loadNextPage = true;
  const updatedManga = [];
  const time = new Date(latestUpdate);
  const updatedAt = time.toISOString().split('.')[0];
  console.log(`Fetching manga updated since ${updatedAt}`);

  while(loadNextPage) {
    const url = new URLBuilder(MANGADEX_API)
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
      const mangaId = chapter.relationships.filter((x) => x.type == 'manga')[0]?.id;

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

async function determineLatestUpdate(epoch) {
  const latestUpdate = await getLatestUpdate();
  if(latestUpdate <= 0) {
    return epoch - Duration.DAY;
  }
  return latestUpdate - Duration.MINUTE;
}

async function queryUpdates() {
  try {
    const epoch = Date.now();
    const mangaIds = await getMangaIdsForQuery(epoch - Duration.WEEK);
    if(!mangaIds) {
      console.log('No manga to check');
      return;
    }
    const latestUpdate = await determineLatestUpdate(epoch);
    const updatedManga = await findUpdatedManga(mangaIds, latestUpdate);
    if(!updatedManga || updatedManga.length == 0) {
      console.log('No updates found');
      return;
    }
    await updateMangaRecordsForQuery(updatedManga, epoch);
  } catch (e) {
    console.error('Encountered error fetching updates', e);
  }
}

schedule.scheduleJob(updateSchedule, queryUpdates);

shutdownHandler()
  .log('SIGINT signal received: exiting scheduler')
  .thenDo(schedule.gracefulShutdown)
  .thenLog('Scheduler shut down; shutting down database pool')
  .thenDo(shutdownPool)
  .thenLog('Database pool shut down; exiting')
  .thenExit(0);
