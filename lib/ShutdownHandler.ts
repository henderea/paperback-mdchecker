export type RunType = 'regular' | 'nodemon';

class ShutdownHandler {
  private readonly _actions: Array<(runType: RunType) => Promise<void>> = [];
  private _defaultExitCode: number = 0;

  private async trigger(runType: RunType): Promise<void> {
    for(const action of this.actions) {
      try {
        await action(runType);
      } catch (e: any) {
        console.error(e);
        this._defaultExitCode = 1;
      }
    }
  }

  constructor() {
    process.on('SIGINT', () => void this.trigger('regular'));
    process.on('SIGUSR2', () => void this.trigger('nodemon'));
  }

  get actions(): Array<(runType: RunType) => Promise<void>> { return this._actions; }
  get defaultExitCode(): number { return this._defaultExitCode; }

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

  exit(exitCode?: number) {
    this.actions.push(async (rt: RunType) => {
      if(rt == 'regular') {
        process.exit(exitCode ?? this.defaultExitCode);
      } else {
        process.kill(process.pid, 'SIGUSR2');
      }
    });
    return this;
  }

  thenDo(action: (...args: any[]) => void | Promise<void>, ...params: any[]) { return this.do(action, ...params); }

  thenLog(logText: string) { return this.log(logText); }

  thenLogIf(logText: string, condition: boolean) { return this.logIf(logText, condition); }

  thenExit(exitCode?: number) { return this.exit(exitCode); }
}

export function shutdownHandler(): ShutdownHandler { return new ShutdownHandler(); }
