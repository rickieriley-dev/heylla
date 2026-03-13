const db = require('../config/db');
 
exports.getGifts = async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM gifts ORDER BY price ASC');
    res.json(rows);
  } catch (err) { next(err); }
};
 
exports.sendGift = async (req, res, next) => {
  try {
    const { recipient_id, gift_id, room_id } = req.body;
    const { rows } = await db.query(
      `INSERT INTO user_gifts (sender_id, recipient_id, gift_id, room_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.id, recipient_id, gift_id, room_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
};
 
