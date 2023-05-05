const { expressPort, expressHost, expressSocketPath, userUpdateSchedule } = require('./env');

const schedule = require('node-schedule');

const express = require('express');
const { createHttpTerminator } = require('http-terminator');


const { shutdownPool, listUsers, getLastUpdate, insertMangaRecord, updateMangaRecordForCheck } = require('./db');

const app = express();

class Users {
  constructor() {
    this._users = [];
  }

  get users() { return this._users; }
  set users(users) { this._users = users; }

  hasUser(userId) { return this.users.includes(userId); }
}

const users = new Users();

async function updateUsers() {
  try {
    users.users = await listUsers();
  } catch (e) {
    console.error('Encountered error updating users', e);
  }
}

schedule.scheduleJob(userUpdateSchedule, updateUsers);

updateUsers();

function checkUser(userId) {
  return users.hasUser(userId);
}

// unknown | updated | current | no-user | error
async function determineState(userId, mangaId, lastCheckEpoch, epoch) {
  try {
    const lastUpdate = await getLastUpdate(userId, mangaId);
    if(lastUpdate < 0) {
      await insertMangaRecord(userId, mangaId, epoch);
      return 'unknown';
    }
    await updateMangaRecordForCheck(userId, mangaId, epoch);
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
  process.on('SIGINT', async () => {
    console.log('SIGINT signal received; closing HTTP server');
    await httpTerminator.terminate();
    console.log('HTTP server closed; shutting down scheduler');
    await schedule.gracefulShutdown();
    console.log('Scheduler shut down, shutting down database pool');
    await shutdownPool();
    console.log('Database pool shut down; exiting');
    process.exit(0);
  });
}

start();
