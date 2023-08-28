const { expressPort, expressHost, expressSocketPath, userUpdateSchedule } = require('./lib/env');

const schedule = require('node-schedule');

const express = require('express');
const { createHttpTerminator } = require('http-terminator');


const { shutdownClient, getRecentCheckCount, getLastUpdate, getLastUserCheck, getUserUpdateCount, insertMangaRecord, updateMangaRecordForCheck, getLastCheck, getLatestUpdateCheck } = require('./lib/db');

const { shutdownHandler } = require('./lib/ShutdownHandler');

const { UserList, Role } = require('./lib/UserList');

const { Duration, formatDate, formatDuration } = require('./lib/utils');

const app = express();

const users = new UserList();

schedule.scheduleJob(userUpdateSchedule, () => users.update());

users.update();

function checkUser(userId) {
  return users.hasUser(userId);
}

function getUser(userId) {
  return users.getUser(userId);
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

/**
 * query: userId
 *
 * returns pretty JSON with one of:
 *  - { state: "error" }
 *  - { state: "no-user" }
 *  - { state: "unknown" }
 *  - { state: "running", start: <time string> }
 *  - { state: "no-series", start: <time string>, end: <time string>, duration: <formatted duration string>, count: -1 }
 *  - { state: "completed", start: <time string>, end: <time string>, duration: <formatted duration string>, count: <number> }
 *
 * With everything other than "error" and "no-user" potentially also having these additional fields related to the provided userId:
 *  - lastUserFetch: <time string>
 *  - updatesSinceLastFetch: <number>
 *
 * Note that "no-series" is for when there were no series to check because nothing has been fetched in the past week.
 */
function prettyJsonResponse(res) {
  return (data) => {
    res.header('Content-Type','application/json');
    res.send(JSON.stringify(data, null, 2));
  };
}

app.get('/last-update-check', async (req, res) => {
  const pjson = prettyJsonResponse(res);
  try {
    const userId = req.query.userId;
    const user = getUser(userId);
    if(!user) {
      pjson({ state: 'no-user' });
      return;
    }
    const userData = {};
    const lastUserCheck = await getLastUserCheck(userId);
    if(lastUserCheck > 0) {
      const lastUserCheckTime = new Date(lastUserCheck);
      userData.lastUserFetch = formatDate(lastUserCheckTime);
      const userUpdateCount = await getUserUpdateCount(userId, lastUserCheck - Duration.HOURS(6));
      userData.updatesSinceLastFetch = userUpdateCount;
    }
    const lastCheck = await getLatestUpdateCheck();
    if(!lastCheck) {
      pjson({ state: 'unknown', ...userData });
      return;
    }
    const start = parseInt(String(lastCheck.check_start_time));
    const startTime = new Date(start);
    if(!lastCheck.check_end_time || lastCheck.check_end_time <= 0) {
      pjson({
        state: 'running',
        start: formatDate(startTime),
        ...userData
      });
      return;
    }
    const end = parseInt(String(lastCheck.check_end_time));
    const endTime = new Date(end);
    const count = user.hasAnyRole(Role.ADMIN) ? lastCheck.update_count : undefined;
    pjson({
      state: count < 0 ? 'no-series' : 'completed',
      start: formatDate(startTime),
      end: formatDate(endTime),
      duration: formatDuration(end - start),
      count,
      ...userData
    });
  } catch (e) {
    console.error('Encountered error in last-update-check request handler', e);
    pjson({ state: 'error' });
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
    // .log('SIGINT signal received; closing HTTP server')
    .log('SIGINT signal received; shutting down')
    .thenDo(httpTerminator.terminate)
    // .thenLog('HTTP server closed; shutting down scheduler')
    .thenDo(schedule.gracefulShutdown)
    // .thenLog('Scheduler shut down, shutting down database client')
    .thenDo(shutdownClient)
    // .thenLog('Database client shut down; exiting')
    .thenLog('Shutdown complete')
    .thenExit();
}

start();
