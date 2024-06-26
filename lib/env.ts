import { ensureInt } from './utils';

function processPort(raw: string | undefined): number | null {
  if(raw) {
    const port = ensureInt(raw);
    if(port > 0) {
      return port;
    }
  }
  return null;
}

function processBoolean(raw: string | undefined, fallback: boolean): boolean {
  if(raw) {
    raw = String(raw);
    if(raw.length > 0) {
      return ['true', 't', 'on', 'yes'].includes(raw);
    }
  }
  return fallback;
}

function processString(raw: string | undefined): string | null {
  if(raw) {
    raw = String(raw);
    if(raw.length > 0) {
      return raw;
    }
  }
  return null;
}

export const expressPort: number | null = processPort(process.env.EXPRESS_PORT);
export const expressHost: string | null = processString(process.env.EXPRESS_HOST);
export const expressSocketPath: string | null = processString(process.env.EXPRESS_SOCKET_PATH);
export const updateSchedule: string = processString(process.env.UPDATE_SCHEDULE) || '*/20 * * * *';
export const titleUpdateSchedule: string = processString(process.env.TITLE_UPDATE_SCHEDULE) || '30 * * * *';
export const deepCheckSchedule: string = processString(process.env.DEEP_CHECK_SCHEDULE) || '10,50 * * * *';
export const userUpdateSchedule: string = processString(process.env.USER_UPDATE_SCHEDULE) || '*/20 * * * *';
export const noStartStopLogs: boolean = processBoolean(process.env.NO_START_STOP_LOGS, false);
export const pushoverAppToken: string | null = processString(process.env.PUSHOVER_APP_TOKEN);
export const baseUrl: string = (processString(process.env.BASE_URL) || '').replace(/\/$/, '');
