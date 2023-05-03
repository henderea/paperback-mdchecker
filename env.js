require('dotenv').config();

const dbHost = process.env.dbHost;
const dbPort = parseInt(process.env.dbPort);
const dbName = process.env.dbName;
const dbUser = process.env.dbUser;
const dbPass = process.env.dbPass;
const serverPort = parseInt(process.env.serverPort);
const serverHost = process.env.serverHost;

module.exports = {
  dbHost,
  dbPort,
  dbName,
  dbUser,
  dbPass,
  serverPort,
  serverHost
};
