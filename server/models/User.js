const db = require('../config/db');
const bcrypt = require('bcryptjs');

const User = {
  async create({ username, email, password }) {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3) RETURNING id, username, email, avatar_url, created_at`,
      [username, email, hash]
    );
    return rows[0];
  },
  async findByEmail(email) {
    const { rows } = await db.query('SELECT * FROM users WHERE email=$1', [email]);
    return rows[0];
  },
  async findById(id) {
    const { rows } = await db.query(
      'SELECT id, username, email, avatar_url, level FROM users WHERE id=$1', [id]
    );
    return rows[0];
  },
  async comparePassword(plain, hash) {
    return bcrypt.compare(plain, hash);
  }
};

module.exports = User;
