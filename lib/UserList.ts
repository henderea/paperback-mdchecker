import type { BasicUserResult, UserResult } from './db';
import { listUsers, listUsersBasic } from './db';

export const roles = ['ADMIN'] as const;
export type Role = typeof roles[number];

export class User {
  private readonly _userId: string;
  private readonly _roles: Role[];
  private readonly _isAdmin: boolean;

  constructor(row: BasicUserResult) {
    this._userId = row.user_id;
    this._roles = `${row.roles}`.split(/,/g).map((s) => s.trim()) as Role[];
    this._isAdmin = this.hasAnyRole('ADMIN');
  }

  get userId(): string { return this._userId; }
  get roles(): Role[] { return this._roles; }
  hasAnyRole(...roles: Role[]) { return this.roles.some((r) => roles.includes(r)); }
  get isAdmin(): boolean { return this._isAdmin; }
  ifAdmin<T>(value: T): T | undefined { return this.isAdmin ? value : undefined; }
  ifAdminF<T>(value: () => T): T | undefined { return this.isAdmin ? value() : undefined; }
  async ifAdminP<T>(value: () => Promise<T>): Promise<T | undefined> { return this.isAdmin ? await value() : undefined; }
}

export class PushoverUser extends User {
  private readonly _pushoverToken: string | null;
  private readonly _pushoverAppTokenOverride: string | null;

  constructor(row: UserResult) {
    super(row);
    this._pushoverToken = row.pushover_token;
    this._pushoverAppTokenOverride = row.pushover_app_token_override;
  }

  get pushoverToken(): string | null { return this._pushoverToken; }
  get pushoverAppTokenOverride(): string | null { return this._pushoverAppTokenOverride; }
  get hasPushover(): boolean { return !!this.pushoverToken; }
  getPushoverAppToken(token: string | null): string | null { return this.pushoverAppTokenOverride ?? token; }
}

function processUsers(data: BasicUserResult[]): Dictionary<User> {
  const rv: Dictionary<User> = {};
  data.forEach((row) => {
    const user = new User(row);
    rv[user.userId] = user;
  });
  return rv;
}

function processPushoverUsers(data: UserResult[]): Dictionary<PushoverUser> {
  const rv: Dictionary<PushoverUser> = {};
  data.forEach((row) => {
    const user = new PushoverUser(row);
    rv[user.userId] = user;
  });
  return rv;
}

export class UserList {
  private _users: Dictionary<User> = {};

  private get users(): Dictionary<User> { return this._users; }
  private set users(users: Dictionary<User>) { this._users = users; }

  getUser(userId: string | null | undefined): User | undefined { return userId ? this.users[userId] : undefined; }

  hasUser(userId: string | null | undefined): boolean { return !!this.getUser(userId); }

  async update(): Promise<void> {
    try {
      this.users = processUsers(await listUsersBasic());
    } catch (e) {
      console.error('Encountered error updating users', e);
    }
  }
}

export class PushoverUserList {
  private _users: Dictionary<PushoverUser> = {};

  private get users(): Dictionary<PushoverUser> { return this._users; }
  private set users(users: Dictionary<PushoverUser>) { this._users = users; }

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
