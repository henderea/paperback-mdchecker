import type { RequestHandler } from 'express';
import type { RedisClientType } from 'redis';

import session from 'express-session';
import RedisStore from 'connect-redis';
import { createClient } from 'redis';

import { noStartStopLogs } from 'lib/env';
import { Duration } from './utils';

declare module 'express-session' {
  interface SessionData {
    lastCheck?: number;
  }
}

const redisClient: RedisClientType = createClient();
redisClient.connect().then(() => {
  if(!noStartStopLogs) {
    console.log('redis connected');
  }
}).catch((e) => {
  console.error('Failed to connect to redis');
  console.error(e);
  process.exit(1);
});

const redisStore: RedisStore = new RedisStore({
  client: redisClient,
  prefix: 'paperback-mdchecker:'
});

export const sessionMiddleware: RequestHandler = session({
  store: redisStore,
  resave: false,
  saveUninitialized: false,
  rolling: false,
  secret: 'paperback-mdchecker secret',
  cookie: {
    maxAge: Duration.DAYS(1),
    secure: false
  }
});

export async function shutdownRedis(): Promise<void> {
  await redisClient.quit();
}
