import type { UserResult } from './db';
import { listUsers } from './db';
import { User } from './UserList';

export class PushoverUser extends User {
  readonly pushoverToken: string | null;
  readonly pushoverAppTokenOverride: string | null;

  constructor(row: UserResult) {
    super(row);
    this.pushoverToken = row.pushover_token;
    this.pushoverAppTokenOverride = row.pushover_app_token_override;
  }

  get hasPushover(): boolean { return !!this.pushoverToken; }
  getPushoverAppToken(token: string | null): string | null { return this.pushoverAppTokenOverride || token; }
}

function processPushoverUsers(data: UserResult[]): Dictionary<PushoverUser> {
  const rv: Dictionary<PushoverUser> = {};
  data.forEach((row) => {
    const user = new PushoverUser(row);
    rv[user.userId] = user;
  });
  return rv;
}

export class PushoverUserList {
  private users: Dictionary<PushoverUser> = {};

  getUser(userId: string | null | undefined): PushoverUser | undefined { return userId ? this.users[userId] : undefined; }

  hasUser(userId: string | null | undefined): boolean { return !!this.getUser(userId); }

  async update(): Promise<void> {
    try {
      this.users = processPushoverUsers(await listUsers());
    } catch (e) {
      console.error('Encountered error updating users', e);
    }
  }
}
