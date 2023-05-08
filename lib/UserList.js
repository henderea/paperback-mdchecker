const { listUsers } = require('./db');

class UserList {
  constructor() {
    this._users = [];
  }

  get users() { return this._users; }
  set users(users) { this._users = users; }

  hasUser(userId) { return this.users.includes(userId); }

  async update() {
    try {
      this.users = await listUsers();
    } catch (e) {
      console.error('Encountered error updating users', e);
    }
  }
}

module.exports = { UserList };
