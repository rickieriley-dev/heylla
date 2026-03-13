const db = require('../config/db');
const redis = require('../config/redis');

const Seat = {
  async getSeats(room_id) {
    const cached = await redis.get(`seats:${room_id}`);
    if (cached) return JSON.parse(cached);
    const { rows } = await db.query(
      `SELECT s.*, u.username, u.avatar_url
       FROM seats s LEFT JOIN users u ON s.user_id = u.id
       WHERE s.room_id = $1 ORDER BY s.seat_number`,
      [room_id]
    );
    await redis.setEx(`seats:${room_id}`, 60, JSON.stringify(rows));
    return rows;
  },
  async takeSeat(room_id, seat_number, user_id) {
    const { rows } = await db.query(
      `UPDATE seats SET user_id=$1, is_occupied=true, joined_at=NOW()
       WHERE room_id=$2 AND seat_number=$3 AND is_occupied=false
       RETURNING *`,
      [user_id, room_id, seat_number]
    );
    await redis.del(`seats:${room_id}`);
    return rows[0];
  },
  async leaveSeat(room_id, user_id) {
    await db.query(
      `UPDATE seats SET user_id=NULL, is_occupied=false, joined_at=NULL
       WHERE room_id=$1 AND user_id=$2`,
      [room_id, user_id]
    );
    await redis.del(`seats:${room_id}`);
  },
  async initSeats(room_id, count = 10) {
    const values = Array.from({ length: count }, (_, i) =>
      `(${room_id}, ${i + 1})`
    ).join(',');
    await db.query(
      `INSERT INTO seats (room_id, seat_number) VALUES ${values} ON CONFLICT DO NOTHING`
    );
  }
};

module.exports = Seat;
