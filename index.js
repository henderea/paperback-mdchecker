const express = require('express');

const { serverPort, serverHost } = require('./env');

const app = express();

// unknown | updated | current
function determineState(userId, mangaId, lastCheckEpoch, epoch) {
  return 'unknown';
}

app.get('/manga-check', (req, res) => {
  const userId = req.query.userId;
  const mangaId = req.query.mangaId;
  const lastCheckEpoch = parseInt(req.query.lastCheckEpoch ?? '0');
  const epoch = Date.now();
  const state = determineState(userId, mangaId, lastCheckEpoch, epoch);
  res.json({ epoch, state });
});

if(serverHost && serverHost.length > 0) {
  app.listen(serverPort, serverHost, () => {
    console.log(`Server running on ${serverHost}:${serverPort}`);
  });
} else {
  app.listen(serverPort, () => {
    console.log(`Server running on port ${serverPort}`);
  });
}
