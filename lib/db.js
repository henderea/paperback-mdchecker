require('./env');

const { Client } = require('pg');

const client = new Client();

client.connect();

async function shutdownClient() {
  await client.end();
}

async function query(text, values = [], rowMode = null) {
  const q = { text, values };
  if(rowMode) {
    q.rowMode = rowMode;
  }
  return client.query(q);
}

async function listUsers() {
  const result = await query('select user_id, roles from user_id');
  if(result.rowCount <= 0) {
    return [];
  }
  return result.rows;
}

async function getRecentCheckCount(userId, minCheck) {
  const result = await query('select count(0) as count from user_manga where user_id = $1 and last_check >= $2', [userId, minCheck]);
  if(result.rowCount <= 0) {
    return 0;
  }
  return parseInt(String(result.rows[0].count));
}

async function getLastCheck(userId, mangaId) {
  const result = await query('select last_check from user_manga where user_id = $1 and manga_id = $2', [userId, mangaId]);
  if(result.rowCount <= 0) {
    return -1;
  }
  return parseInt(String(result.rows[0].last_check));
}

async function getLastUserCheck(userId) {
  const result = await query('select max(last_check) as latest_check from user_manga where user_id = $1', [userId]);
  if(result.rowCount <= 0) {
    return -1;
  }
  return parseInt(String(result.rows[0].latest_check));
}

async function getUserUpdateCount(userId, latestCheck) {
  const result = await query('select count(0) as count from user_manga where user_id = $1 and last_check > $2 and last_update > last_check', [userId, latestCheck]);
  if(result.rowCount <= 0) {
    return -1;
  }
  return parseInt(String(result.rows[0].count));
}

async function getLastUpdate(userId, mangaId) {
  const result = await query('select last_update from user_manga where user_id = $1 and manga_id = $2', [userId, mangaId]);
  if(result.rowCount <= 0) {
    return -1;
  }
  return parseInt(String(result.rows[0].last_update));
}

async function insertMangaRecord(userId, mangaId, epoch) {
  await query('insert into user_manga (user_id, manga_id, last_check, last_update) values ($1, $2, $3, $4)', [userId, mangaId, epoch, 0]);
}

async function updateMangaRecordForCheck(userId, mangaId, epoch) {
  await query('update user_manga set last_check = $3 where user_id = $1 and manga_id = $2', [userId, mangaId, epoch]);
}

async function getMangaIdsForQuery(minCheck) {
  const result = await query('select distinct manga_id from user_manga where last_check >= $1', [minCheck], 'array');
  if(result.rowCount <= 0) {
    return null;
  }
  return result.rows.map((r) => r[0]);
}

async function getLatestUpdate() {
  const result = await query('select max(last_update) as latest_update from user_manga');
  if(result.rowCount <= 0) {
    return -1;
  }
  return parseInt(String(result.rows[0].latest_update));
}

async function updateMangaRecordsForQuery(mangaIds, epoch) {
  await query('update user_manga set last_update = $2 where manga_id = ANY ($1)', [mangaIds, epoch]);
}

async function addUpdateCheck(epoch) {
  await query('insert into update_check (check_start_time) values ($1)', [epoch]);
}

async function updateCompletedUpdateCheck(start_epoch, end_epoch, count) {
  await query('update update_check set check_end_time = $2, update_count = $3 where check_start_time = $1', [start_epoch, end_epoch, count]);
}

async function getLatestUpdateCheck() {
  const result = await query('select check_start_time, check_end_time, update_count from update_check order by check_start_time desc limit 1');
  if(result.rowCount <= 0) {
    return null;
  }
  return result.rows[0];
}

module.exports = {
  shutdownClient,
  listUsers,
  getRecentCheckCount,
  getLastUpdate,
  getLastCheck,
  getLastUserCheck,
  getUserUpdateCount,
  insertMangaRecord,
  updateMangaRecordForCheck,
  getMangaIdsForQuery,
  getLatestUpdate,
  updateMangaRecordsForQuery,
  addUpdateCheck,
  updateCompletedUpdateCheck,
  getLatestUpdateCheck
};
