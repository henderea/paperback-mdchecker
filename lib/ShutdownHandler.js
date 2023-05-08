class ShutdownHandler {
  constructor() {
    this._actions = [];
    process.on('SIGINT', async () => {
      for(const action of this.actions) {
        await action();
      }
    });
  }

  get actions() { return this._actions; }

  do(action, ...params) {
    if(typeof action === 'function') {
      this.actions.push(async () => action(...params));
    }
    return this;
  }

  log(logText) { return this.do(console.log, logText); }

  exit(exitCode = 0) { return this.do(process.exit, exitCode); }

  thenDo(action, ...params) { return this.do(action, ...params); }

  thenLog(logText) { return this.log(logText); }

  thenExit(exitCode = 0) { return this.exit(exitCode); }
}

function shutdownHandler() { return new ShutdownHandler(); }

module.exports = { shutdownHandler };
