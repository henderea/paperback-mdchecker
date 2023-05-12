const { expressPort, expressHost, expressSocketPath, userUpdateSchedule } = require('./lib/env');

const schedule = require('node-schedule');

const express = require('express');
const { createHttpTerminator } = require('http-terminator');


const { shutdownPool, getRecentUpdateCount, getLastUpdate, insertMangaRecord, updateMangaRecordForCheck } = require('./lib/db');

const { shutdownHandler } = require('./lib/ShutdownHandler');

const { UserList } = require('./lib/UserList');

const { Duration } = require('./lib/utils');

const app = express();

const users = new UserList();

schedule.scheduleJob(userUpdateSchedule, () => users.update());

users.update();

function checkUser(userId) {
  return users.hasUser(userId);
}

// unknown | updated | current | no-user | error
async function determineState(userId, mangaId, lastCheckEpoch, epoch) {
  try {
    const recentUpdateCount = await getRecentUpdateCount(userId, epoch - Duration.SECONDS(10));
    const lastUpdate = await getLastUpdate(userId, mangaId);
    if(lastUpdate < 0) {
      await insertMangaRecord(userId, mangaId, epoch);
      return 'unknown';
    }
    await updateMangaRecordForCheck(userId, mangaId, epoch);
    if(recentUpdateCount < 2) { return 'updated'; }
    return lastUpdate < lastCheckEpoch ? 'current' : 'updated';
  } catch (e) {
    console.error('Encountered error determining state', e);
    return 'error';
  }
}

/**
 * Header: user-id
 * query: mangaId
 * query: lastCheckEpoch
 *
 * returns: { epoch, state } (as json)
 * where epoch is a number and state is 'unknown', 'updated', 'current', 'no-user', or 'error'
 */
app.get('/manga-check', async (req, res) => {
  try {
    const userId = req.header('user-id');
    if(!checkUser(userId)) {
      res.json({ epoch: 0, state: 'no-user' });
      return;
    }
    const mangaId = req.query.mangaId;
    const lastCheckEpoch = parseInt(req.query.lastCheckEpoch ?? '0');
    const epoch = Date.now();
    const state = await determineState(userId, mangaId, lastCheckEpoch, epoch);
    res.json({ epoch, state });
  } catch (e) {
    console.error('Encountered error in request handler', e);
    res.json({ epoch: 0, state: 'error' });
  }
});

function startServerListen() {
  if(expressSocketPath) {
    return app.listen(expressSocketPath, () => {
      console.log(`Server running on unix socket ${expressSocketPath}`);
    });
  } else if(expressHost && expressPort) {
    return app.listen(expressPort, expressHost, () => {
      console.log(`Server running on ${expressHost}:${expressPort}`);
    });
  } else if(expressPort) {
    return app.listen(expressPort, () => {
      console.log(`Server running on port ${expressPort}`);
    });
  } else {
    console.error('No valid configuration found');
    process.exit(1);
  }
}

function start() {
  const server = startServerListen();
  const httpTerminator = createHttpTerminator({ server });
  shutdownHandler()
    .log('SIGINT signal received; closing HTTP server')
    .thenDo(httpTerminator.terminate)
    .thenLog('HTTP server closed; shutting down scheduler')
    .thenDo(schedule.gracefulShutdown)
    .thenLog('Scheduler shut down, shutting down database pool')
    .thenDo(shutdownPool)
    .thenLog('Database pool shut down; exiting')
    .thenExit();
}

start();
