import type { QueryResult, QueryResultRow } from 'pg';

import { ensureInt } from './utils';

import { Client } from 'pg';

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

async function aQuery<T extends QueryResultRow>(text: string, values: any[] = []): Promise<QueryResult<T>> {
  return query(text, values, 'array');
}

export declare interface BasicUserResult {
  user_id: string;
  roles: string | null;
}

export declare interface UserResult extends BasicUserResult {
  pushover_token: string | null;
  pushover_app_token_override: string | null;
}

declare interface EmptyResult<T extends QueryResultRow> extends QueryResult<T> {
  rowCount: null | 0;
}

function resultEmpty<T extends QueryResultRow>(result: QueryResult<T>): result is EmptyResult<T> {
  return (result.rowCount ?? 0) <= 0;
}

export async function listUsersBasic(): Promise<BasicUserResult[]> {
  const result: QueryResult<BasicUserResult> = await query('select user_id, roles from user_id');
  if(resultEmpty(result)) {
    return [];
  }
  return result.rows;
}

export async function listUsers(): Promise<UserResult[]> {
  const result: QueryResult<UserResult> = await query('select user_id, roles, pushover_token, pushover_app_token_override from user_id');
  if(resultEmpty(result)) {
    return [];
  }
  return result.rows;
}

export async function getRecentCheckCount(userId: string, minCheck: number): Promise<number> {
  const result: QueryResult<[number]> = await aQuery('select count(0) from user_manga where user_id = $1 and last_check >= $2', [userId, minCheck]);
  if(resultEmpty(result)) {
    return 0;
  }
  return ensureInt(result.rows[0][0]);
}

export async function getLastCheck(userId: string, mangaId: string): Promise<number> {
  const result: QueryResult<[number]> = await aQuery('select last_check from user_manga where user_id = $1 and manga_id = $2', [userId, mangaId]);
  if(resultEmpty(result)) {
    return -1;
  }
  return ensureInt(result.rows[0][0]);
}

export async function getLastUserCheck(userId: string): Promise<number> {
  const result: QueryResult<[number]> = await aQuery('select max(last_check) from user_manga where user_id = $1', [userId]);
  if(resultEmpty(result)) {
    return -1;
  }
  return ensureInt(result.rows[0][0]);
}

export async function getUserUpdateCount(userId: string, latestCheck: number): Promise<number> {
  const result: QueryResult<[number]> = await aQuery('select count(0) from user_manga where user_id = $1 and last_check > $2 and last_update > last_check', [userId, latestCheck]);
  if(resultEmpty(result)) {
    return -1;
  }
  return ensureInt(result.rows[0][0]);
}

export async function getUserUpdates(userId: string, latestCheck: number): Promise<MangaUpdateInfo[]> {
  const result: QueryResult<[string, string | null, number]> = await aQuery('select manga_id, manga_title, last_update from user_manga where user_id = $1 and last_check > $2 and last_update > last_check order by last_update, manga_title, manga_id', [userId, latestCheck]);
  if(resultEmpty(result)) {
    return [];
  }
  return result.rows.map(([id, title, lastUpdate]) => ({ id, title: title ?? null, lastUpdate: ensureInt(lastUpdate) }));
}

export async function getUserChecks(userId: string, latestCheck: number): Promise<number> {
  const result: QueryResult<[number]> = await aQuery('select count(0) from user_manga where user_id = $1 and last_check > $2', [userId, latestCheck]);
  if(resultEmpty(result)) {
    return 0;
  }
  return result.rows[0][0];
}

export async function getLastUpdate(userId: string, mangaId: string): Promise<number> {
  const result: QueryResult<[number]> = await aQuery('select last_update from user_manga where user_id = $1 and manga_id = $2', [userId, mangaId]);
  if(resultEmpty(result)) {
    return -1;
  }
  return ensureInt(result.rows[0][0]);
}

export async function insertMangaRecord(userId: string, mangaId: string, epoch: number): Promise<void> {
  await query('insert into user_manga (user_id, manga_id, last_check, last_update) values ($1, $2, $3, $4)', [userId, mangaId, epoch, 0]);
}

export async function updateMangaRecordForCheck(userId: string, mangaId: string, epoch: number): Promise<void> {
  await query('update user_manga set last_check = $3 where user_id = $1 and manga_id = $2', [userId, mangaId, epoch]);
}

export async function getMangaIdsForQuery(minCheck: number): Promise<string[] | null> {
  const result: QueryResult<[string]> = await aQuery('select distinct manga_id from user_manga where last_check >= $1', [minCheck]);
  if(resultEmpty(result)) {
    return null;
  }
  return result.rows.map((r) => r[0]);
}

export async function getTitleCheckMangaIds(limit: number, maxCheck: number): Promise<string[] | null> {
  const result: QueryResult<[string]> = await aQuery('select manga_id from user_manga where last_title_check <= $2 group by manga_id order by min(last_title_check) asc, max(last_update) desc, max(last_check) desc, manga_id asc limit $1', [limit, maxCheck]);
  if(resultEmpty(result)) {
    return null;
  }
  return result.rows.map((r) => r[0]);
}

export async function getLatestUpdate(): Promise<number> {
  const result: QueryResult<[number]> = await aQuery('select max(last_update) as latest_update from user_manga');
  if(resultEmpty(result)) {
    return -1;
  }
  return ensureInt(result.rows[0][0]);
}

export declare interface MangaInfo {
  id: string;
  title: string | null;
}

export declare interface TitledMangaInfo {
  manga_id: string;
  manga_title: string;
}

export declare interface MangaUpdateInfo extends MangaInfo {
  lastUpdate: number;
}

export async function updateMangaRecordsForQuery(mangaIds: string[], epoch: number): Promise<void> {
  await query('update user_manga set last_update = $2 where manga_id = ANY ($1)', [mangaIds, epoch]);
}

export async function updateMangaTitles(mangas: MangaInfo[], epoch: number): Promise<void> {
  for(let i = 0; i < mangas.length; i++) {
    const manga: MangaInfo = mangas[i];
    if(manga.title) {
      await query('update user_manga set manga_title = $2, last_title_check = $3 where manga_id = $1', [manga.id, manga.title, epoch]);
    }
  }
}

export async function addUpdateCheck(epoch: number): Promise<void> {
  await query('insert into update_check (check_start_time) values ($1)', [epoch]);
}

export async function updateCompletedUpdateCheck(startEpoch: number, endEpoch: number, count: number, hitPageFetchLimit: boolean): Promise<void> {
  await query('update update_check set check_end_time = $2, update_count = $3, hit_page_fetch_limit = $4 where check_start_time = $1', [startEpoch, endEpoch, count, hitPageFetchLimit]);
}

export declare interface UserPushUpdateResult {
  count: number;
  user_id: string;
  pushover_token: string;
  pushover_app_token_override: string | null;
}

export async function listUserPushUpdates(epoch: number): Promise<UserPushUpdateResult[] | null> {
  const result: QueryResult<UserPushUpdateResult> = await query(`select count(distinct manga_id) as count, user_id, pushover_token, pushover_app_token_override from user_manga join user_id using (user_id) where pushover_token is not null and pushover_token != '' and last_update = $1 group by user_id, pushover_token, pushover_app_token_override`, [epoch]);
  if(resultEmpty(result)) {
    return null;
  }
  return result.rows;
}

export declare interface UpdateCheckResult {
  check_start_time: number;
  check_end_time: number | null;
  update_count: number;
}

export async function getLatestUpdateCheck(): Promise<UpdateCheckResult | null> {
  const result: QueryResult<UpdateCheckResult> = await query('select check_start_time, check_end_time, update_count from update_check order by check_start_time desc limit 1');
  if(resultEmpty(result)) {
    return null;
  }
  return result.rows[0];
}

export async function getUnknownTitles(userId: string, isAdmin: boolean): Promise<string[] | null> {
  const result: QueryResult<[string]> = await aQuery(`select manga_id from user_manga where (manga_title is null or length(manga_title) <= 0) and user_id = $1${isAdmin ? ' and manga_id not in (select distinct manga_id from failed_titles)' : ''}`, [userId]);
  if(resultEmpty(result)) {
    return null;
  }
  return result.rows.map((r) => r[0]);
}

export async function getNonLatinTitles(userId: string): Promise<TitledMangaInfo[] | null> {
  const result: QueryResult<TitledMangaInfo> = await query(`select manga_id, manga_title from user_manga where user_id = $1 and manga_title is not null and length(manga_title) > 0 and manga_title ~* '[^[:alnum:][:blank:][:punct:][:cntrl:]]'`, [userId]);
  if(resultEmpty(result)) {
    return null;
  }
  return result.rows;
}

export declare interface FailedTitle {
  manga_id: string;
  last_failure: number;
}

export async function getFailedTitles(): Promise<FailedTitle[] | null> {
  const result: QueryResult<FailedTitle> = await query('select manga_id, last_failure from failed_titles order by last_failure desc');
  if(resultEmpty(result)) {
    return null;
  }
  return result.rows;
}

export async function addFailedTitles(mangaIds: string[], epoch: number): Promise<void> {
  for(const mangaId of mangaIds) {
    await query('insert into failed_titles (manga_id, last_failure) values ($1, $2)', [mangaId, epoch]);
  }
}

export async function cleanFailedTitles(mangaIds: string[]): Promise<void> {
  await query('delete from failed_titles where manga_id = ANY ($1)', [mangaIds]);
}
