const db = require('../config/db');
const User = require('../models/User');
const redis = require('../config/redis');

// Source of truth for gift costs — matches client GIFTS array
const GIFT_COSTS = {
  '👏': 500,   '🌹': 10,    '💎': 99,    '🎆': 300,
  '🚀': 2000,  '👑': 999,   '💕': 50000, '📱': 99999,
  '🎵': 600,   '🍀': 400,   '🎁': 700,   '⭐': 1500,
};

module.exports = (io, socket) => {
  socket.on('gift:send', async ({ roomId, giftType, giftName, qty = 1, targetUserId }) => {
    const unitCost = GIFT_COSTS[giftType];
    if (!unitCost) return socket.emit('gift:error', 'Unknown gift type');

    const safeQty = Math.min(Math.max(1, parseInt(qty, 10) || 1), 99);
    const totalCost = unitCost * safeQty;

    // Deduct coins — will fail if insufficient balance
    const updated = await User.deductCoins(socket.user.id, totalCost);
    if (!updated) {
      return socket.emit('gift:error', 'Not enough coins');
    }

    // Persist gift record
    await db.query(
      `INSERT INTO gifts (room_id, from_user_id, to_user_id, gift_type, gift_name, qty, total_cost)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [roomId, socket.user.id, targetUserId || null, giftType, giftName, safeQty, totalCost]
    );

    // Accumulate room trophy total
    await db.query(
      'UPDATE rooms SET trophy = trophy + $1 WHERE id = $2',
      [totalCost, roomId]
    );

    // Track per-user trophy earnings for leaderboard
    if (targetUserId) {
      await db.query(
        `INSERT INTO room_trophies (room_id, user_id, amount)
         VALUES ($1, $2, $3)
         ON CONFLICT (room_id, user_id) DO UPDATE SET amount = room_trophies.amount + $3`,
        [roomId, targetUserId, totalCost]
      );
    }

    // Invalidate seat cache so updated trophy data flows on next join
    await redis.del(`seats:${roomId}`);

    // Broadcast to everyone in the room
    io.to(roomId).emit('gift:received', {
      from: { id: socket.user.id, username: socket.user.username },
      to: targetUserId,
      giftType,
      giftName,
      qty: safeQty,
      totalCost,
      timestamp: new Date().toISOString(),
    });

    // Confirm updated coin balance to sender only
    socket.emit('coins:updated', { coins: updated.coins });
  });

  socket.on('reaction:send', ({ roomId, emoji }) => {
    io.to(roomId).emit('reaction:received', {
      userId: socket.user.id,
      username: socket.user.username,
      emoji,
    });
  });
};
