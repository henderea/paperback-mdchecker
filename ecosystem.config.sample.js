// for use with pm2
// should be named ecosystem.config.js

module.exports = {
  apps : [{
    name: 'paperback-mdchecker-api',
    script: './build/app/index.js',
    exec_mode: 'cluster',
    instances: 'max',
    time: true,
    env: {
      'NODE_ENV': 'production',
      'PGHOST': 'localhost',
      'PGPORT': 5432,
      'PGDATABASE': 'mdchecker',
      'PGUSER': 'mdchecker',
      'PGPASSWORD': 'mdchecker',
      'EXPRESS_PORT': 3000,
      // 'EXPRESS_HOST': 'localhost',
      // 'EXPRESS_SOCKET_PATH': '/tmp/paperback-mdchecker.sock',
      'UPDATE_SCHEDULE': '*/20 * * * *',
      'TITLE_UPDATE_SCHEDULE': '30 * * * *',
      'USER_UPDATE_SCHEDULE': '*/20 * * * *',
      'NO_START_STOP_LOGS': true,
      'PUSHOVER_APP_TOKEN': 'abc123'
    }
  }, {
    name: 'paperback-mdchecker-checker',
    script: './build/update-check/index.js',
    instances: 1,
    time: true,
    env: {
      'NODE_ENV': 'production',
      'PGHOST': 'localhost',
      'PGPORT': 5432,
      'PGDATABASE': 'mdchecker',
      'PGUSER': 'mdchecker',
      'PGPASSWORD': 'mdchecker',
      'EXPRESS_PORT': 3000,
      // 'EXPRESS_HOST': 'localhost',
      // 'EXPRESS_SOCKET_PATH': '/tmp/paperback-mdchecker.sock',
      'UPDATE_SCHEDULE': '*/20 * * * *',
      'TITLE_UPDATE_SCHEDULE': '30 * * * *',
      'USER_UPDATE_SCHEDULE': '*/20 * * * *',
      'NO_START_STOP_LOGS': true,
      'PUSHOVER_APP_TOKEN': 'abc123'
    }
  }]
};
