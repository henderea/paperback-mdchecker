class Durations {
  get SECOND(): number { return 1000; }
  get MINUTE(): number { return this.SECONDS(60); }
  get HOUR(): number { return this.MINUTES(60); }
  get DAY(): number { return this.HOURS(24); }
  get WEEK(): number { return this.DAYS(7); }
  SECONDS(num: number) { return this.SECOND * num; }
  MINUTES(num: number) { return this.MINUTE * num; }
  HOURS(num: number) { return this.HOUR * num; }
  DAYS(num: number) { return this.DAY * num; }
  WEEKS(num: number) { return this.WEEK * num; }
}

export const Duration: Durations = new Durations();

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'US/Eastern', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', month: 'short', weekday: 'short' }).format(date);
}

export function formatEpoch(epoch: number): string {
  return formatDate(new Date(epoch));
}

export function formatDuration(d: number): string {
  const h: number = Math.floor(d / (60 * 60 * 1000));
  const m: number = Math.floor((d / (60 * 1000)) % 60);
  const s: number = Math.floor((d / 1000) % 60);
  const ms: number = d % 1000;
  const parts: string[] = [];
  if(h > 0) { parts.push(`${h} h`); }
  if(m > 0) { parts.push(`${m} m`); }
  if(s > 0) { parts.push(`${s} s`); }
  if(ms > 0) { parts.push(`${ms} ms`); }
  return parts.join(' ');
}

export function formatDurationShort(d: number, maxForSeconds: number = Duration.MINUTES(20), maxForMinutes: number = Duration.HOURS(12)): string {
  if(d < 1000) {
    return '0s';
  }
  const h: number = Math.floor(d / (60 * 60 * 1000));
  const m: number = Math.floor((d / (60 * 1000)) % 60);
  const s: number = Math.floor((d / 1000) % 60);
  const parts: string[] = [];
  if(h > 0) { parts.push(`${h}h`); }
  if(d < maxForMinutes && m > 0) { parts.push(`${m}m`); }
  if(d < maxForSeconds && s > 0) { parts.push(`${s}s`); }
  return parts.join(' ');
}

export function ensureInt(v: number | string | any): number {
  return parseInt(String(v));
}

export async function catchError<T, F = undefined>(p: Promise<T>, message: string, fallback: F): Promise<T | F> {
  try {
    return await p;
  } catch (e) {
    console.error(message, e);
    return fallback;
  }
}

export async function catchVoidError(p: Promise<void>, message: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    console.error(message, e);
  }
}
