import './env';

import { Client, QueryResult, QueryResultRow } from 'pg';

const client = new Client();

client.connect().catch((e) => {
  console.error('Failed to connect to database!');
  console.error(e);
  process.exit(1);
});

export async function shutdownClient(): Promise<void> {
  await client.end();
}

async function query<T extends QueryResultRow>(text: string, values: any[] = [], rowMode: string | null = null): Promise<QueryResult<T>> {
  const q: { text: string, values: any[], rowMode?: string } = { text, values };
  if(rowMode) {
    q.rowMode = rowMode;
  }
  return client.query(q);
}

export declare interface UserResult {
  user_id: string;
  roles: string | null;
}

export async function listUsers(): Promise<UserResult[]> {
  const result: QueryResult<UserResult> = await query('select user_id, roles from user_id');
  if(result.rowCount <= 0) {
    return [];
  }
  return result.rows;
}

export async function getRecentCheckCount(userId: string, minCheck: number): Promise<number> {
  const result: QueryResult<{ count: number }> = await query('select count(0) as count from user_manga where user_id = $1 and last_check >= $2', [userId, minCheck]);
  if(result.rowCount <= 0) {
    return 0;
  }
  return parseInt(String(result.rows[0].count));
}

export async function getLastCheck(userId: string, mangaId: string): Promise<number> {
  const result: QueryResult<{ last_check: number }> = await query('select last_check from user_manga where user_id = $1 and manga_id = $2', [userId, mangaId]);
  if(result.rowCount <= 0) {
    return -1;
  }
  return parseInt(String(result.rows[0].last_check));
}

export async function getLastUserCheck(userId: string): Promise<number> {
  const result: QueryResult<{ latest_check: number }> = await query('select max(last_check) as latest_check from user_manga where user_id = $1', [userId]);
  if(result.rowCount <= 0) {
    return -1;
  }
  return parseInt(String(result.rows[0].latest_check));
}

export async function getUserUpdateCount(userId: string, latestCheck: number): Promise<number> {
  const result: QueryResult<{ count: number }> = await query('select count(0) as count from user_manga where user_id = $1 and last_check > $2 and last_update > last_check', [userId, latestCheck]);
  if(result.rowCount <= 0) {
    return -1;
  }
  return parseInt(String(result.rows[0].count));
}

export async function getLastUpdate(userId: string, mangaId: string): Promise<number> {
  const result: QueryResult<{ last_update: number }> = await query('select last_update from user_manga where user_id = $1 and manga_id = $2', [userId, mangaId]);
  if(result.rowCount <= 0) {
    return -1;
  }
  return parseInt(String(result.rows[0].last_update));
}

export async function insertMangaRecord(userId: string, mangaId: string, epoch: number): Promise<void> {
  await query('insert into user_manga (user_id, manga_id, last_check, last_update) values ($1, $2, $3, $4)', [userId, mangaId, epoch, 0]);
}

export async function updateMangaRecordForCheck(userId: string, mangaId: string, epoch: number): Promise<void> {
  await query('update user_manga set last_check = $3 where user_id = $1 and manga_id = $2', [userId, mangaId, epoch]);
}

export async function getMangaIdsForQuery(minCheck: number): Promise<string[] | null> {
  const result: QueryResult<[string]> = await query('select distinct manga_id from user_manga where last_check >= $1', [minCheck], 'array');
  if(result.rowCount <= 0) {
    return null;
  }
  return result.rows.map((r) => r[0]);
}

export async function getLatestUpdate(): Promise<number> {
  const result: QueryResult<{ latest_update: number }> = await query('select max(last_update) as latest_update from user_manga');
  if(result.rowCount <= 0) {
    return -1;
  }
  return parseInt(String(result.rows[0].latest_update));
}

export async function updateMangaRecordsForQuery(mangaIds: string[], epoch: number): Promise<void> {
  await query('update user_manga set last_update = $2 where manga_id = ANY ($1)', [mangaIds, epoch]);
}

export async function addUpdateCheck(epoch: number): Promise<void> {
  await query('insert into update_check (check_start_time) values ($1)', [epoch]);
}

export async function updateCompletedUpdateCheck(startEpoch: number, endEpoch: number, count: number): Promise<void> {
  await query('update update_check set check_end_time = $2, update_count = $3 where check_start_time = $1', [startEpoch, endEpoch, count]);
}

export interface UpdateCheckResult {
  check_start_time: number;
  check_end_time: number | null;
  update_count: number;
}

export async function getLatestUpdateCheck(): Promise<UpdateCheckResult | null> {
  const result: QueryResult<UpdateCheckResult> = await query('select check_start_time, check_end_time, update_count from update_check order by check_start_time desc limit 1');
  if(result.rowCount <= 0) {
    return null;
  }
  return result.rows[0];
}
