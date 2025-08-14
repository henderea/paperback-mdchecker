import type { BasicUserResult } from './db';
import { listUsersBasic } from './db';

export const roles = ['ADMIN'] as const;
export declare type Role = typeof roles[number];

export class User {
  readonly userId: string;
  readonly roles: Role[];
  readonly isAdmin: boolean;

  constructor(row: BasicUserResult) {
    this.userId = row.user_id;
    this.roles = `${row.roles}`.split(/,/g).map((s) => s.trim()) as Role[];
    this.isAdmin = this.hasAnyRole('ADMIN');
  }

  hasAnyRole(...roles: Role[]) { return this.roles.some((r) => roles.includes(r)); }
  ifAdmin<T>(value: T): T | undefined { return this.isAdmin ? value : undefined; }
  ifAdminF<T>(value: () => T): T | undefined { return this.isAdmin ? value() : undefined; }
  async ifAdminP<T>(value: () => Promise<T>): Promise<T | undefined> { return this.isAdmin ? await value() : undefined; }
}

function processUsers(data: BasicUserResult[]): Dictionary<User> {
  const rv: Dictionary<User> = {};
  data.forEach((row) => {
    const user = new User(row);
    rv[user.userId] = user;
  });
  return rv;
}

export class UserList {
  private users: Dictionary<User> = {};

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
