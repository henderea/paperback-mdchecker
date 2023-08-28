const { listUsers } = require('./db');

const Role = {
  ADMIN: 'ADMIN'
};

class User {
  constructor(row) {
    this._userId = row.user_id;
    this._roles = `${row.roles}`.split(/,/g).map((s) => s.trim());
  }

  get userId() { return this._userId; }
  get roles() { return this._roles; }
  hasAnyRole(...roles) { return this.roles.some((r) => roles.includes(r)); }
}

function processUsers(data) {
  const rv = {};
  data.forEach((row) => {
    const user = new User(row);
    rv[user.userId] = user;
  });
  return rv;
}

class UserList {
  constructor() {
    this._users = {};
  }

  get users() { return this._users; }
  set users(users) { this._users = users; }

  getUser(userId) { return this.users[userId]; }

  hasUser(userId) { return !!this.getUser(userId); }

  async update() {
    try {
      this.users = processUsers(await listUsers());
    } catch (e) {
      console.error('Encountered error updating users', e);
    }
  }
}

module.exports = { UserList, Role };
