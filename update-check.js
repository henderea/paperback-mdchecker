const schedule = require('node-schedule');
const got = require('got');

const { shutdownPool, getMangaIdsForQuery, getLatestUpdate, updateMangaRecordsForQuery } = require('./db');

const { updateSchedule } = require('./env');

const { URLBuilder } = require('./UrlBuilder');

const sec = 1000;
const min = sec * 60;
const hour = min * 60;
const day = hour * 24;
const week = day * 7;

const MANGADEX_DOMAIN = 'https://mangadex.org';
const MANGADEX_API = 'https://api.mangadex.org';

async function findUpdatedManga(mangaIds, latestUpdate) {
  let offset = 0;
  const maxRequests = 100;
  let loadNextPage = true;
  const updatedManga = [];
  const time = new Date(latestUpdate);
  const updatedAt = time.toISOString().split('.')[0];
  console.log(`Fetching manga updated since ${updatedAt}`);
  while(loadNextPage) {
    const url = new URLBuilder(MANGADEX_API)
      .addPathComponent('chapter')
      .addQueryParameter('limit', 100)
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

    offset = offset + 100;
    if(json.total <= offset || offset >= (100 * maxRequests)) {
      loadNextPage = false;
    }
  }

  return updatedManga;
}

async function queryUpdates() {
  try {
    const epoch = Date.now();
    const mangaIds = await getMangaIdsForQuery(epoch - week);
    if(!mangaIds) {
      console.log('No manga to check');
      return;
    }
    let latestUpdate = await getLatestUpdate();
    if(latestUpdate <= 0) {
      latestUpdate = epoch - day;
    }
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

process.on('SIGINT', () => {
  console.log('SIGINT signal received: exiting scheduler');
  schedule.gracefulShutdown().then(() => {
    console.log('Scheduler shut down');
    return shutdownPool();
  }).then(() => {
    console.log('Database pool shut down');
  });
});
