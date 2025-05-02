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

async function snQuery(text: string, values: any[] = []): Promise<number | null> {
  const result: QueryResult<[number]> = await aQuery(text, values);
  if(resultEmpty(result)) {
    return null;
  }
  return ensureInt(result.rows[0][0]);
}

async function scQuery<T>(text: string, values: any[] = []): Promise<T[] | null> {
  const result: QueryResult<[T]> = await aQuery(text, values);
  if(resultEmpty(result)) {
    return null;
  }
  return result.rows.map((r: [T]) => r[0]);
}

async function srQuery<T extends QueryResultRow>(text: string, values: any[] = []): Promise<T | null> {
  const result: QueryResult<T> = await query(text, values);
  if(resultEmpty(result)) {
    return null;
  }
  return result.rows[0];
}

async function lQuery<T extends QueryResultRow>(text: string, values: any[] = []): Promise<T[] | null> {
  const result: QueryResult<T> = await query(text, values);
  if(resultEmpty(result)) {
    return null;
  }
  return result.rows;
}

async function laQuery<T extends QueryResultRow>(text: string, values: any[] = []): Promise<T[] | null> {
  const result: QueryResult<T> = await aQuery(text, values);
  if(resultEmpty(result)) {
    return null;
  }
  return result.rows;
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
  return await lQuery('select user_id, roles from user_id') ?? [];
}

export async function listUsers(): Promise<UserResult[]> {
  return await lQuery('select user_id, roles, pushover_token, pushover_app_token_override from user_id') ?? [];
}

export async function getRecentCheckCount(userId: string, minCheck: number): Promise<number> {
  return await snQuery('select count(0) from user_manga where user_id = $1 and last_check >= $2', [userId, minCheck]) ?? 0;
}

export async function getLastCheck(userId: string, mangaId: string): Promise<number> {
  return await snQuery('select last_check from user_manga where user_id = $1 and manga_id = $2', [userId, mangaId]) ?? -1;
}

export async function getLastUserCheck(userId: string): Promise<number> {
  return await snQuery('select max(last_check) from user_manga where user_id = $1', [userId]) ?? -1;
}

export async function getUserUpdateCount(userId: string, latestCheck: number): Promise<number> {
  return await snQuery('select count(0) from user_manga where user_id = $1 and last_check > $2 and last_update > last_check', [userId, latestCheck]) ?? -1;
}

export async function getUserUpdates(userId: string, latestCheck: number): Promise<MangaUpdateInfo[]> {
  const results: Array<[string, string | null, number]> | null = await laQuery('select manga_id, manga_title, last_update from user_manga where user_id = $1 and last_check > $2 and last_update > last_check order by last_update, manga_title, manga_id', [userId, latestCheck]);
  return results?.map(([id, title, lastUpdate]) => ({ id, title: title ?? null, lastUpdate: ensureInt(lastUpdate) })) ?? [];
}

export async function getUserChecks(userId: string, latestCheck: number): Promise<number> {
  return await snQuery('select count(0) from user_manga where user_id = $1 and last_check > $2', [userId, latestCheck]) ?? 0;
}

export async function getLastUpdate(userId: string, mangaId: string): Promise<number> {
  return await snQuery('select last_update from user_manga where user_id = $1 and manga_id = $2', [userId, mangaId]) ?? -1;
}

export async function insertMangaRecord(userId: string, mangaId: string, epoch: number): Promise<void> {
  await query('insert into user_manga (user_id, manga_id, last_check, last_update, last_deep_check_find) values ($1, $2, $3, $4, $3)', [userId, mangaId, epoch, 0]);
}

export async function updateMangaRecordForCheck(userId: string, mangaId: string, epoch: number): Promise<void> {
  await query('update user_manga set last_check = $3 where user_id = $1 and manga_id = $2', [userId, mangaId, epoch]);
}

export async function getMangaIdsForQuery(minCheck: number): Promise<string[] | null> {
  return await scQuery('select distinct manga_id from user_manga where last_check >= $1', [minCheck]);
}

export async function getTitleCheckMangaIds(limit: number, maxCheck: number): Promise<string[] | null> {
  return await scQuery('select manga_id from user_manga where last_title_check <= $2 group by manga_id order by min(last_title_check) asc, max(last_update) desc, max(last_check) desc, manga_id asc limit $1', [limit, maxCheck]);
}

export async function getDeepCheckMangaIds(limit: number, minCheck: number, maxDeepCheck: number): Promise<[string, number, number, number][] | null> {
  return await laQuery('select manga_id, max(last_update), max(last_deep_check), max(last_deep_check_find) from user_manga where last_check >= $2 and greatest(last_update, last_deep_check) <= $3 group by manga_id order by min(greatest(last_update, last_deep_check)) asc, max(last_deep_check_find) asc, max(last_update) asc, max(last_check) desc, manga_id asc limit $1', [limit, minCheck, maxDeepCheck]);
}

export async function getLatestUpdate(): Promise<number> {
  return await snQuery('select max(last_update) as latest_update from user_manga where last_update != last_deep_check') ?? -1;
}

export declare interface MangaInfo {
  id: string;
  title: string | null;
}

export declare interface TitledMangaInfo {
  manga_id: string;
  manga_title: string;
}

export declare interface MangaTitleCheckInfo extends MangaInfo {
  status: string | null;
  lastVolume: string | null;
  lastChapter: string | null;
}

export declare interface MangaUpdateInfo extends MangaInfo {
  lastUpdate: number;
}

export async function updateMangaRecordsForQuery(mangaIds: string[], epoch: number): Promise<void> {
  await query('update user_manga set last_update = $2 where manga_id = ANY ($1)', [mangaIds, epoch]);
}

export async function updateMangaRecordsForDeepQuery(checkedManga: [string, number][], epoch: number): Promise<void> {
  for(let i = 0; i < checkedManga.length; i++) {
    const [mangaId, deepCheckFind]: [string, number] = checkedManga[i];
    await query('update user_manga set last_deep_check = $2, last_deep_check_find = $3 where manga_id = $1', [mangaId, epoch, deepCheckFind]);
  }
}

export async function updateMangaTitles(mangas: MangaTitleCheckInfo[], epoch: number): Promise<void> {
  for(let i = 0; i < mangas.length; i++) {
    const manga: MangaTitleCheckInfo = mangas[i];
    if(manga.title) {
      await query('update user_manga set manga_title = $2, manga_status = $3, last_title_check = $4, last_volume = $5, last_chapter = $6 where manga_id = $1', [manga.id, manga.title, manga.status, epoch, manga.lastVolume, manga.lastChapter]);
    }
  }
}

export async function addUpdateCheck(epoch: number): Promise<void> {
  await query('insert into update_check (check_start_time) values ($1)', [epoch]);
}

export async function updateCompletedUpdateCheck(startEpoch: number, endEpoch: number, count: number, hitPageFetchLimit: boolean): Promise<void> {
  await query('update update_check set check_end_time = $2, update_count = $3, hit_page_fetch_limit = $4 where check_start_time = $1', [startEpoch, endEpoch, count, hitPageFetchLimit]);
}

export async function addTitleCheck(epoch: number): Promise<void> {
  await query('insert into title_check (check_start_time) values ($1)', [epoch]);
}

export async function updateCompletedTitleCheck(startEpoch: number, endEpoch: number, count: number): Promise<void> {
  await query('update title_check set check_end_time = $2, check_count = $3 where check_start_time = $1', [startEpoch, endEpoch, count]);
}

export async function addDeepCheck(epoch: number): Promise<void> {
  await query('insert into deep_check (check_start_time) values ($1)', [epoch]);
}

export async function updateCompletedDeepCheck(startEpoch: number, endEpoch: number, updateCount: number, checkCount: number): Promise<void> {
  await query('update deep_check set check_end_time = $2, update_count = $3, check_count = $4 where check_start_time = $1', [startEpoch, endEpoch, updateCount, checkCount]);
}

export async function updateInProgressDeepCheck(startEpoch: number, checkCount: number): Promise<void> {
  await query('update deep_check set check_count = $2 where check_start_time = $1', [startEpoch, checkCount]);
}

export declare interface UserPushUpdateResult {
  count: number;
  user_id: string;
  pushover_token: string;
  pushover_app_token_override: string | null;
}

export async function listUserPushUpdates(epoch: number): Promise<UserPushUpdateResult[] | null> {
  return await lQuery(`select count(distinct manga_id) as count, user_id, pushover_token, pushover_app_token_override from user_manga join user_id using (user_id) where pushover_token is not null and pushover_token != '' and last_update = $1 group by user_id, pushover_token, pushover_app_token_override`, [epoch]);
}

export declare interface UpdateCheckResult {
  check_start_time: number;
  check_end_time: number | null;
  update_count: number;
}

export async function getLatestUpdateCheck(): Promise<UpdateCheckResult | null> {
  return await srQuery('select check_start_time, check_end_time, update_count from update_check order by check_start_time desc limit 1');
}

export async function getUnknownTitles(userId: string, isAdmin: boolean): Promise<string[] | null> {
  return await scQuery(`select manga_id from user_manga where (manga_title is null or length(manga_title) <= 0) and user_id = $1${isAdmin ? ' and manga_id not in (select distinct manga_id from failed_titles)' : ''}`, [userId]);
}

export async function getNonLatinTitles(userId: string): Promise<TitledMangaInfo[] | null> {
  return await lQuery(`select manga_id, manga_title from user_manga where user_id = $1 and manga_title is not null and length(manga_title) > 0 and manga_title ~* '[^[:alnum:][:blank:][:punct:][:cntrl:]]'`, [userId]);
}

export declare interface FailedTitle {
  manga_id: string;
  last_failure: number;
}

export async function getFailedTitles(): Promise<FailedTitle[] | null> {
  return await lQuery('select manga_id, last_failure from failed_titles order by last_failure desc');
}

export async function addFailedTitles(mangaIds: string[], epoch: number): Promise<void> {
  for(const mangaId of mangaIds) {
    await query('insert into failed_titles (manga_id, last_failure) values ($1, $2)', [mangaId, epoch]);
  }
}

export async function cleanFailedTitles(mangaIds: string[]): Promise<void> {
  await query('delete from failed_titles where manga_id = ANY ($1)', [mangaIds]);
}
