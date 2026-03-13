const User = require('../models/User');
const db = require('../config/db');

exports.getUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) { next(err); }
};

exports.updateUser = async (req, res, next) => {
  try {
    const { username, avatar_url } = req.body;
    const { rows } = await db.query(
      `UPDATE users SET username=COALESCE($1, username), avatar_url=COALESCE($2, avatar_url)
       WHERE id=$3 RETURNING id, username, email, avatar_url, level`,
      [username, avatar_url, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
};

// Follow or unfollow a user (toggle)
exports.followUser = async (req, res, next) => {
  try {
    const followerId = req.user.id;
    const followingId = parseInt(req.params.id);
    if (followerId === followingId) return res.status(400).json({ error: 'Cannot follow yourself' });

    const { rows } = await db.query(
      'SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2',
      [followerId, followingId]
    );

    if (rows.length > 0) {
      await db.query('DELETE FROM follows WHERE follower_id=$1 AND following_id=$2', [followerId, followingId]);
      res.json({ following: false });
    } else {
      await db.query('INSERT INTO follows (follower_id, following_id) VALUES ($1,$2)', [followerId, followingId]);
      res.json({ following: true });
    }
  } catch (err) { next(err); }
};

// Check if current user follows a specific user
exports.checkFollow = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2',
      [req.user.id, req.params.id]
    );
    res.json({ following: rows.length > 0 });
  } catch (err) { next(err); }
};

// Get live rooms of users that current user follows
exports.getFollowingRooms = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT r.*, u.username as host_username, u.avatar_url as host_avatar,
              COUNT(DISTINCT s.user_id) as listener_count
       FROM follows f
       JOIN rooms r ON r.host_id = f.following_id
       JOIN users u ON u.id = r.host_id
       LEFT JOIN seats s ON s.room_id = r.id AND s.is_occupied = true
       WHERE f.follower_id = $1 AND r.is_active = true
       GROUP BY r.id, u.username, u.avatar_url
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
};
