import type { UserResult } from './db';
import { listUsers } from './db';

export const roles = ['ADMIN'] as const;
export type Role = typeof roles[number];

export class User {
  private readonly _userId: string;
  private readonly _roles: Role[];
  private readonly _isAdmin: boolean;
  private readonly _pushoverToken: string | null;

  constructor(row: UserResult) {
    this._userId = row.user_id;
    this._roles = `${row.roles}`.split(/,/g).map((s) => s.trim()) as Role[];
    this._isAdmin = this.hasAnyRole('ADMIN');
    this._pushoverToken = row.pushover_token;
  }

  get userId(): string { return this._userId; }
  get roles(): Role[] { return this._roles; }
  hasAnyRole(...roles: Role[]) { return this.roles.some((r) => roles.includes(r)); }
  get isAdmin(): boolean { return this._isAdmin; }
  ifAdmin<T>(value: T): T | undefined { return this.isAdmin ? value : undefined; }
  ifAdminF<T>(value: () => T): T | undefined { return this.isAdmin ? value() : undefined; }
  async ifAdminP<T>(value: () => Promise<T>): Promise<T | undefined> { return this.isAdmin ? await value() : undefined; }
  get pushoverToken(): string | null { return this._pushoverToken; }
  get hasPushover(): boolean { return !!this.pushoverToken; }
}

function processUsers(data: UserResult[]): Dictionary<User> {
  const rv: Dictionary<User> = {};
  data.forEach((row) => {
    const user = new User(row);
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
      this.users = processUsers(await listUsers());
    } catch (e) {
      console.error('Encountered error updating users', e);
    }
  }
}
