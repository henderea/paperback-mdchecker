const { expressPort, expressHost, expressSocketPath } = require('./env');

const express = require('express');
const { createHttpTerminator } = require('http-terminator');


const { shutdownPool, checkUser, getLastUpdate, insertMangaRecord, updateMangaRecordForCheck } = require('./db');

const app = express();

// unknown | updated | current | no-user | error
async function determineState(userId, mangaId, lastCheckEpoch, epoch) {
  try {
    if(!await checkUser(userId)) {
      return 'no-user';
    }
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

app.get('/manga-check', async (req, res) => {
  const userId = req.query.userId;
  const mangaId = req.query.mangaId;
  const lastCheckEpoch = parseInt(req.query.lastCheckEpoch ?? '0');
  const epoch = Date.now();
  const state = await determineState(userId, mangaId, lastCheckEpoch, epoch);
  res.json({ epoch, state });
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
  process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    httpTerminator.terminate().then(() => {
      console.log('HTTP server closed');
      return shutdownPool();
    }).then(() => {
      console.log('Database pool shut down');
    });
  });
}

start();
