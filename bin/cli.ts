import ipc from 'node-ipc';

ipc.config.id = 'mdcUpdateChecker-client';
ipc.config.retry = 1500;
ipc.config.sync = false;
ipc.config.silent = true;

const command: string = process.argv[2];

if(!command || !['title-check', 'deep-check'].includes(command)) {
  console.error('You must provide a valid command\nSupported commands are "title-check" and "deep-check".');
  process.exit(1);
}

const nameMap: Record<string, string> = {
  'title-check': 'Title Check',
  'deep-check': 'Deep Check'
};

const commandName: string = nameMap[command];

const CLEAR_LINE: string = '\r\u001b[K';

function doErrorExit(message: string): void {
  ipc.disconnect('mdcUpdateChecker');
  console.error(`${CLEAR_LINE}${message}`);
  process.exit(1);
}

function doExit(message: string | null = null): void {
  ipc.disconnect('mdcUpdateChecker');
  if(message) { console.log(`${CLEAR_LINE}${message}`); }
  process.exit(0);
}

ipc.connectTo('mdcUpdateChecker', () => {
  ipc.of.mdcUpdateChecker.on('connect', () => {
    ipc.of.mdcUpdateChecker.emit('trigger', command);
  })
    .on('unsupported', () => {
      doErrorExit(`Command "${command}" is unsupported`);
    })
    .on('already-running', () => {
      doErrorExit(`A ${commandName} is already running`);
    })
    .on('no-items', () => {
      doExit(`The ${commandName} did not have any items to run`);
    })
    .on('failure', (result: string) => {
      doErrorExit(`the ${commandName} failed with code ${result}`);
    })
    .on('success', (result: string) => {
      if(command === 'title-check') {
        doExit(`The ${commandName} fetched ${result} title(s)`);
      } else if(command === 'deep-check') {
        doExit(`The ${commandName} checked ${result} series`);
      } else {
        doExit(`The ${commandName} had ${result} result(s)`);
      }
    })
    .on('progress', (progress: string) => {
      process.stdout.write(`${CLEAR_LINE}Progress: ${progress}`);
    });
});
