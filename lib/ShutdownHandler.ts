export type RunType = 'regular' | 'nodemon';

class ShutdownHandler {
  readonly actions: Array<(runType: RunType) => Promise<void>> = [];

  constructor() {
    process.on('SIGINT', async () => {
      for(const action of this.actions) {
        try {
          await action('regular');
        } catch { /* ignore */ }
      }
    });
    process.on('SIGUSR2', async () => {
      for(const action of this.actions) {
        try {
          await action('nodemon');
        } catch { /* ignore */ }
      }
    });
  }

  do(action: (...args: any[]) => void | Promise<void>, ...params: any[]) {
    if(typeof action === 'function') {
      this.actions.push(async () => action(...params));
    }
    return this;
  }

  runTypeDo(runType: RunType, action: (...args: any[]) => void | Promise<void>, ...params: any[]) {
    if(typeof action === 'function') {
      this.actions.push(async (rt: RunType) => { if(rt == runType) { action(...params); } });
    }
    return this;
  }

  log(logText: string) { return this.do(console.log, logText); }

  logIf(logText: string, condition: boolean) { return condition ? this.log(logText) : this; }

  exit(exitCode: number = 0) {
    return this
      .runTypeDo('regular', process.exit, exitCode)
      .runTypeDo('nodemon', () => { process.kill(process.pid, 'SIGUSR2'); });
  }

  thenDo(action: (...args: any[]) => void | Promise<void>, ...params: any[]) { return this.do(action, ...params); }

  thenLog(logText: string) { return this.log(logText); }

  thenLogIf(logText: string, condition: boolean) { return this.logIf(logText, condition); }

  thenExit(exitCode: number = 0) { return this.exit(exitCode); }
}

export function shutdownHandler(): ShutdownHandler { return new ShutdownHandler(); }
