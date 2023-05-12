require('./env');

const { Pool } = require('pg');

const pool = new Pool();

async function shutdownPool() {
  await pool.end();
}

async function query(text, values = [], rowMode = null) {
  const q = { text, values };
  if(rowMode) {
    q.rowMode = rowMode;
  }
  return pool.query(q);
}

async function listUsers() {
  const result = await query('select user_id from user', [], 'array');
  if(result.rowCount <= 0) {
    return [];
  }
  return result.rows.map((r) => r[0]);
}

async function getRecentUpdateCount(userId, minCheck) {
  const result = await query('select count(0) as count from user_manga where user_id = $1 and last_check >= $2', [userId, minCheck]);
  if(result.rowCount <= 0) {
    return 0;
  }
  return result.rows[0].count;
}

async function getLastUpdate(userId, mangaId) {
  const result = await query('select last_update from user_manga where user_id = $1 and manga_id = $2', [userId, mangaId]);
  if(result.rowCount <= 0) {
    return -1;
  }
  return result.rows[0].last_update;
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
  return result.rows[0].latest_update;
}

async function updateMangaRecordsForQuery(mangaIds, epoch) {
  await query('update user_manga set last_update = $2 where manga_id = ANY ($1)', [mangaIds, epoch]);
}

module.exports = {
  shutdownPool,
  listUsers,
  getRecentUpdateCount,
  getLastUpdate,
  insertMangaRecord,
  updateMangaRecordForCheck,
  getMangaIdsForQuery,
  getLatestUpdate,
  updateMangaRecordsForQuery
};
