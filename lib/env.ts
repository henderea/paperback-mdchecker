import { ensureInt } from './utils';

// if(process.env.NODE_ENV != 'production') {
//   require('dotenv').config();
// }

function processPort(raw: string | undefined): number | null {
  if(raw) {
    const port = ensureInt(raw);
    if(port > 0) {
      return port;
    }
  }
  return null;
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
export const userUpdateSchedule: string = processString(process.env.USER_UPDATE_SCHEDULE) || '*/20 * * * *';
