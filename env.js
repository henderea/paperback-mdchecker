if(process.env.NODE_ENV != 'production') {
  require('dotenv').config();
}

function processPort(raw) {
  if(raw) {
    const port = parseInt(`${raw}`);
    if(port > 0) {
      return port;
    }
  }
  return null;
}

function processString(raw) {
  if(raw) {
    raw = `${raw}`;
    if(raw.length > 0) {
      return raw;
    }
  }
  return null;
}

const expressPort = processPort(process.env.EXPRESS_PORT);
const expressHost = processString(process.env.EXPRESS_HOST);
const expressSocketPath = processString(process.env.EXPRESS_SOCKET_PATH);
const updateSchedule = processString(process.env.UPDATE_SCHEDULE) || '*/20 * * * *';

module.exports = {
  expressPort,
  expressHost,
  expressSocketPath,
  updateSchedule
};
