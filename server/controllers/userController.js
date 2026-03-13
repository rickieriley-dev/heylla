const User = require('../models/User');

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
    const { rows } = await require('../config/db').query(
      `UPDATE users SET username=COALESCE($1, username), avatar_url=COALESCE($2, avatar_url)
       WHERE id=$3 RETURNING id, username, email, avatar_url, level`,
      [username, avatar_url, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
};
