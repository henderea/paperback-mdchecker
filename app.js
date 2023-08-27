const { expressPort, expressHost, expressSocketPath, userUpdateSchedule } = require('./lib/env');

const schedule = require('node-schedule');

const express = require('express');
const { createHttpTerminator } = require('http-terminator');


const { shutdownClient, getRecentCheckCount, getLastUpdate, insertMangaRecord, updateMangaRecordForCheck, getLastCheck, getLatestUpdateCheck } = require('./lib/db');

const { shutdownHandler } = require('./lib/ShutdownHandler');

const { UserList } = require('./lib/UserList');

const { Duration, formatDate, formatDuration } = require('./lib/utils');

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
    const recentCheckCount = await getRecentCheckCount(userId, epoch - Duration.SECONDS(5));
    const lastCheck = await getLastCheck(userId, mangaId);
    const lastUpdate = await getLastUpdate(userId, mangaId);
    if(lastUpdate < 0 || lastCheck < 0) { // not fetched before
      await insertMangaRecord(userId, mangaId, epoch);
      return 'unknown';
    }
    await updateMangaRecordForCheck(userId, mangaId, epoch);
    if(lastCheck < (epoch - Duration.DAYS(6))) { // hasn't been fetched recently, so the checker may not have been checking it
      return 'unknown';
    }
    if(recentCheckCount < 2) { // if we haven't been checking a bunch of series quickly, this may be a regular series view load, so tell it to fetch data
      return 'updated';
    }
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
    if(!checkUser(userId)) { // if the user isn't in the table, reject the request right away
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

app.get('/last-update-check', async (req, res) => {
  try {
    const userId = req.query.userId;
    if(!checkUser(userId)) {
      res.json({ state: 'no-user' });
      return;
    }
    const lastCheck = await getLatestUpdateCheck();
    if(!lastCheck) {
      res.json({ state: 'unknown' });
      return;
    }
    const startTime = new Date(lastCheck.check_start_time);
    if(!lastCheck.check_end_time || lastCheck.check_end_time <= 0) {
      res.json({
        state: 'running',
        start: formatDate(startTime)
      });
      return;
    }
    const endTime = new Date(lastCheck.check_end_time);
    const count = lastCheck.count;
    res.json({
      state: count < 0 ? 'no-series' : 'completed',
      start: formatDate(startTime),
      end: formatDate(endTime),
      duration: formatDuration(lastCheck.check_end_time - lastCheck.check_start_time ),
      count
    });
  } catch (e) {
    console.error('Encountered error in last-update-check request handler', e);
    res.json({ state: 'error' });
  }
});

function startServerListen() {
  if(expressSocketPath) { // using unix socket
    return app.listen(expressSocketPath, () => {
      console.log(`Server running on unix socket ${expressSocketPath}`);
    });
  } else if(expressHost && expressPort) { // using host & port
    return app.listen(expressPort, expressHost, () => {
      console.log(`Server running on ${expressHost}:${expressPort}`);
    });
  } else if(expressPort) { // using just port
    return app.listen(expressPort, () => {
      console.log(`Server running on port ${expressPort}`);
    });
  } else { // nothing configured
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
    .thenLog('Scheduler shut down, shutting down database client')
    .thenDo(shutdownClient)
    .thenLog('Database client shut down; exiting')
    .thenExit();
}

start();
