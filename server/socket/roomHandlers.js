const Seat = require('../models/Seat');
const Room = require('../models/Room');
const db = require('../config/db');
const redis = require('../config/redis'); // Fix #1: was missing
const bcrypt = require('bcryptjs');

// ── Helpers ──────────────────────────────────────────────────────────────────
const isHost = async (roomId, userId) => {
  const { rows } = await db.query('SELECT host_id FROM rooms WHERE id=$1', [roomId]);
  return rows[0]?.host_id === userId;
};

const isAdmin = async (roomId, userId) => {
  const { rows } = await db.query(
    'SELECT id FROM room_admins WHERE room_id=$1 AND user_id=$2', [roomId, userId]
  );
  return rows.length > 0;
};

const isHostOrAdmin = async (roomId, userId) =>
  (await isHost(roomId, userId)) || (await isAdmin(roomId, userId));

const getAdminIds = async (roomId) => {
  const { rows } = await db.query('SELECT user_id FROM room_admins WHERE room_id=$1', [roomId]);
  return rows.map(r => r.user_id);
};

const broadcastViewerCount = async (io, roomId) => {
  const sockets = await io.in(roomId).fetchSockets();
  io.to(roomId).emit('room:viewers', { count: sockets.length });
};

// ── Handler ───────────────────────────────────────────────────────────────────
module.exports = (io, socket) => {
  // Per-socket chat rate limit: max 1 message per 500ms
  const chatLastSent = { ts: 0 };

  // ── JOIN / LEAVE ────────────────────────────────────────────────────────────
  socket.on('room:join', async ({ roomId }) => {
    socket.join(roomId);
    socket.currentRoom = roomId;

    const [seats, room, adminIds] = await Promise.all([
      Seat.getSeats(roomId),
      Room.findById(roomId),
      getAdminIds(roomId),
    ]);

    socket.emit('room:seats', seats);
    socket.emit('room:info', { room, admins: adminIds });
    io.to(roomId).emit('room:user_joined', {
      userId: socket.user.id,
      username: socket.user.username,
    });
    await broadcastViewerCount(io, roomId); // Fix #9: emit viewer count
  });

  socket.on('room:leave', async ({ roomId }) => {
    await Seat.leaveSeat(roomId, socket.user.id);
    socket.leave(roomId);
    const seats = await Seat.getSeats(roomId);
    io.to(roomId).emit('room:seats', seats);
    io.to(roomId).emit('room:user_left', { userId: socket.user.id });
    await broadcastViewerCount(io, roomId);
  });

  // ── SEAT MANAGEMENT ─────────────────────────────────────────────────────────
  socket.on('seat:take', async ({ roomId, seatNumber }) => {
    const allSeats = await Seat.getSeats(roomId);
    const target = allSeats.find(s => s.seat_number === seatNumber);
    if (target?.is_locked) return socket.emit('seat:error', 'Seat is locked');

    // Leave any existing seat first — prevents double avatar bug
    await Seat.leaveSeat(roomId, socket.user.id);

    const seat = await Seat.takeSeat(roomId, seatNumber, socket.user.id);
    if (!seat) return socket.emit('seat:error', 'Seat already taken');
    const seats = await Seat.getSeats(roomId);
    io.to(roomId).emit('room:seats', seats);
  });

  socket.on('seat:leave', async ({ roomId }) => {
    await Seat.leaveSeat(roomId, socket.user.id);
    const seats = await Seat.getSeats(roomId);
    io.to(roomId).emit('room:seats', seats);
  });

  // Fix #3: seat:request handler was completely missing
  socket.on('seat:request', async ({ roomId, seatNumber }) => {
    const allSeats = await Seat.getSeats(roomId);
    const target = allSeats.find(s => s.seat_number === seatNumber);
    if (!target || target.is_occupied || target.is_locked) return;
    // Notify host (and admins) via room broadcast; RoomPage filters by isHost
    io.to(roomId).emit('seat:mic_request', {
      userId: socket.user.id,
      username: socket.user.username,
      seatNumber,
    });
  });

  // Fix #: host approve mic request
  socket.on('host:approve_request', async ({ roomId, userId, seatNumber }) => {
    if (!(await isHostOrAdmin(roomId, socket.user.id))) return;
    const allSeats = await Seat.getSeats(roomId);
    const target = allSeats.find(s => s.seat_number === seatNumber);
    if (!target || target.is_occupied) return;
    // Notify the requesting user
    io.to(roomId).emit('seat:approved', {
      userId,
      seatNumber,
      fromName: socket.user.username,
    });
  });

  // ── HOST: INVITE ─────────────────────────────────────────────────────────────
  // Fix #2: emit fromName (was emitting `from`) to match client listener
  socket.on('host:invite', async ({ roomId, userId, seatNumber }) => {
    if (!(await isHostOrAdmin(roomId, socket.user.id))) return;
    io.to(roomId).emit('seat:invite', {
      userId,
      seatNumber,
      fromName: socket.user.username, // was `from`
    });
  });

  // ── HOST: MUTE ───────────────────────────────────────────────────────────────
  socket.on('host:mute_seat', async ({ roomId, seatNumber, muted }) => {
    if (!(await isHostOrAdmin(roomId, socket.user.id))) return;
    await db.query(
      'UPDATE seats SET is_muted=$1 WHERE room_id=$2 AND seat_number=$3',
      [muted, roomId, seatNumber]
    );
    await redis.del(`seats:${roomId}`);
    const seats = await Seat.getSeats(roomId);
    io.to(roomId).emit('room:seats', seats);
    io.to(roomId).emit('seat:force_mute', { seatNumber, muted });
  });

  // ── HOST: LOCK/UNLOCK ────────────────────────────────────────────────────────
  socket.on('host:lock_seat', async ({ roomId, seatNumber, locked }) => {
    if (!(await isHostOrAdmin(roomId, socket.user.id))) return;
    await db.query(
      'UPDATE seats SET is_locked=$1 WHERE room_id=$2 AND seat_number=$3',
      [locked, roomId, seatNumber]
    );
    await redis.del(`seats:${roomId}`);
    const seats = await Seat.getSeats(roomId);
    io.to(roomId).emit('room:seats', seats);
  });

  // ── HOST: KICK ───────────────────────────────────────────────────────────────
  // Fix #1: redis was used but never imported (now imported at top)
  socket.on('host:kick_seat', async ({ roomId, seatNumber }) => {
    if (!(await isHostOrAdmin(roomId, socket.user.id))) return;
    await db.query(
      `UPDATE seats SET user_id=NULL, is_occupied=false, joined_at=NULL
       WHERE room_id=$1 AND seat_number=$2`,
      [roomId, seatNumber]
    );
    await redis.del(`seats:${roomId}`);
    const seats = await Seat.getSeats(roomId);
    io.to(roomId).emit('room:seats', seats);
  });

  // ── HOST: ADMIN MANAGEMENT ───────────────────────────────────────────────────
  socket.on('host:set_admin', async ({ roomId, userId }) => {
    if (!(await isHost(roomId, socket.user.id))) return;
    await db.query(
      `INSERT INTO room_admins (room_id, user_id, appointed_by)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [roomId, userId, socket.user.id]
    );
    const adminIds = await getAdminIds(roomId);
    io.to(roomId).emit('room:admins', adminIds);
  });

  socket.on('host:remove_admin', async ({ roomId, userId }) => {
    if (!(await isHost(roomId, socket.user.id))) return;
    await db.query(
      'DELETE FROM room_admins WHERE room_id=$1 AND user_id=$2',
      [roomId, userId]
    );
    const adminIds = await getAdminIds(roomId);
    io.to(roomId).emit('room:admins', adminIds);
  });

  // ── ROOM SETTINGS ────────────────────────────────────────────────────────────
  // Fix: hash room password server-side before storing
  socket.on('room:update_settings', async ({ roomId, name, announcement, password, cover_url }) => {
    if (!(await isHost(roomId, socket.user.id))) return;

    let hashedPassword = undefined;
    if (password !== undefined && password !== '') {
      hashedPassword = await bcrypt.hash(password, 10);
    } else if (password === '') {
      // Empty string = remove password
      hashedPassword = null;
    }

    await db.query(
      `UPDATE rooms SET
        name        = COALESCE($1, name),
        announcement= COALESCE($2, announcement),
        password    = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE password END,
        cover_url   = COALESCE($4, cover_url)
       WHERE id = $5`,
      [name, announcement, hashedPassword, cover_url || null, roomId]
    );
    await redis.del(`room:${roomId}`);
    const room = await Room.findById(roomId);
    io.to(roomId).emit('room:settings_updated', room);
  });

  // Fix #4: room:end handler was completely missing
  socket.on('room:end', async ({ roomId }) => {
    if (!(await isHost(roomId, socket.user.id))) return;
    await Room.deactivate(roomId);
    io.to(roomId).emit('room:closed');
  });

  // ── CHAT ─────────────────────────────────────────────────────────────────────
  // Fix: server-side rate limit (1 msg / 500ms per socket)
  socket.on('chat:message', ({ roomId, message }) => {
    const now = Date.now();
    if (now - chatLastSent.ts < 500) return; // silently drop
    chatLastSent.ts = now;

    if (!message || typeof message !== 'string') return;
    const trimmed = message.trim().slice(0, 200);
    if (!trimmed) return;

    io.to(roomId).emit('chat:message', {
      userId: socket.user.id,
      username: socket.user.username,
      message: trimmed,
      timestamp: new Date().toISOString(),
    });
  });

  // ── VOICE MUTE (self) ────────────────────────────────────────────────────────
  socket.on('voice:mute', ({ roomId, muted }) => {
    io.to(roomId).emit('voice:mute', { userId: socket.user.id, muted });
  });

  // ── DISCONNECT ───────────────────────────────────────────────────────────────
  socket.on('disconnect', async () => {
    const roomId = socket.currentRoom;
    if (roomId) {
      await Seat.leaveSeat(roomId, socket.user.id);
      const seats = await Seat.getSeats(roomId);
      io.to(roomId).emit('room:seats', seats);
      io.to(roomId).emit('room:user_left', { userId: socket.user.id });
      await broadcastViewerCount(io, roomId);
    }
  });
};
