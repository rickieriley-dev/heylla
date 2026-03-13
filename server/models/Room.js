const db = require('../config/db');

const Room = {
  async create({ name, host_id, tag, description, is_locked = false }) {
    const { rows } = await db.query(
      `INSERT INTO rooms (name, host_id, tag, description, is_locked)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, host_id, tag, description, is_locked]
    );
    return rows[0];
  },
  async findAll() {
    const { rows } = await db.query(
      `SELECT r.*, u.username as host_name, u.username as host_username, u.avatar_url as host_avatar,
       COUNT(DISTINCT s.user_id) as listener_count
       FROM rooms r
       JOIN users u ON r.host_id = u.id
       LEFT JOIN seats s ON s.room_id = r.id AND s.is_occupied = true
       WHERE r.is_active = true
       GROUP BY r.id, u.username, u.avatar_url
       ORDER BY COUNT(DISTINCT s.user_id) DESC`
    );
    return rows;
  },
  async findById(id) {
    const { rows } = await db.query('SELECT * FROM rooms WHERE id=$1', [id]);
    return rows[0];
  },
  async updateListeners(room_id, count) {
    await db.query('UPDATE rooms SET listener_count=$1 WHERE id=$2', [count, room_id]);
  },
  async deactivate(id) {
    await db.query('UPDATE rooms SET is_active=false WHERE id=$1', [id]);
  },
  async findByHostId(host_id) {
    const { rows } = await db.query(
      `SELECT r.id, r.name, r.tag, r.description, r.is_active, r.is_locked,
              r.host_id, r.created_at, r.listener_count,
              u.username as host_username, u.avatar_url as host_avatar,
              COUNT(DISTINCT s.user_id) as listener_count
       FROM rooms r
       JOIN users u ON r.host_id = u.id
       LEFT JOIN seats s ON s.room_id = r.id AND s.is_occupied = true
       WHERE r.host_id = $1 AND r.is_active = true
       GROUP BY r.id, u.username, u.avatar_url
       ORDER BY r.created_at DESC
       LIMIT 1`,
      [host_id]
    );
    return rows[0] || null;
  },
  async deactivateAllByHost(host_id) {
    await db.query('UPDATE rooms SET is_active=false WHERE host_id=$1', [host_id]);
  }
};

module.exports = Room;
