class ShutdownHandler {
  private readonly _actions: Array<() => Promise<void>> = [];

  constructor() {
    process.on('SIGINT', async () => {
      for(const action of this.actions) {
        await action();
      }
    });
  }

  get actions(): Array<() => Promise<void>> { return this._actions; }

  do(action: (...args: any[]) => void | Promise<void>, ...params: any[]) {
    if(typeof action === 'function') {
      this.actions.push(async () => action(...params));
    }
    return this;
  }

  log(logText: string) { return this.do(console.log, logText); }

  logIf(logText: string, condition: boolean) { return condition ? this.log(logText) : this; }

  exit(exitCode: number = 0) { return this.do(process.exit, exitCode); }

  thenDo(action: (...args: any[]) => void | Promise<void>, ...params: any[]) { return this.do(action, ...params); }

  thenLog(logText: string) { return this.log(logText); }

  thenLogIf(logText: string, condition: boolean) { return this.logIf(logText, condition); }

  thenExit(exitCode: number = 0) { return this.exit(exitCode); }
}

export function shutdownHandler(): ShutdownHandler { return new ShutdownHandler(); }
