export type RunType = 'regular' | 'nodemon';

class ShutdownHandler {
  readonly actions: Array<(runType: RunType) => Promise<void>> = [];

  private async trigger(runType: RunType): Promise<void> {
    for(const action of this.actions) {
      try {
        await action(runType);
      } catch (e: any) {
        console.error(e);
      }
    }
  }

  constructor() {
    process.on('SIGINT', () => void this.trigger('regular'));
    process.on('SIGUSR2', () => void this.trigger('nodemon'));
  }

  do(action: (...args: any[]) => void | Promise<void>, ...params: any[]) {
    if(typeof action === 'function') {
      this.actions.push(async () => action(...params));
    }
    return this;
  }

  runTypeDo(runType: RunType, action: (...args: any[]) => void | Promise<void>, ...params: any[]) {
    if(typeof action === 'function') {
      this.actions.push(async (rt: RunType) => { if(rt == runType) { return action(...params); } });
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
