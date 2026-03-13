const Seat = require('../models/Seat');
const Room = require('../models/Room');
const db = require('../config/db');

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

const isHostOrAdmin = async (roomId, userId) => {
  return (await isHost(roomId, userId)) || (await isAdmin(roomId, userId));
};

module.exports = (io, socket) => {
  socket.on('room:join', async ({ roomId }) => {
    socket.join(roomId);
    socket.currentRoom = roomId;
    const seats = await Seat.getSeats(roomId);
    const room = await Room.findById(roomId);
    const { rows: admins } = await db.query(
      'SELECT user_id FROM room_admins WHERE room_id=$1', [roomId]
    );
    socket.emit('room:seats', seats);
    socket.emit('room:info', { room, admins: admins.map(a => a.user_id) });
    io.to(roomId).emit('room:user_joined', {
      userId: socket.user.id,
      username: socket.user.username
    });
  });

  socket.on('room:leave', async ({ roomId }) => {
    await Seat.leaveSeat(roomId, socket.user.id);
    socket.leave(roomId);
    const seats = await Seat.getSeats(roomId);
    io.to(roomId).emit('room:seats', seats);
    io.to(roomId).emit('room:user_left', { userId: socket.user.id });
  });

  // SEAT MANAGEMENT
  socket.on('seat:take', async ({ roomId, seatNumber }) => {
    const allSeats = await Seat.getSeats(roomId);
    const targetSeat = allSeats.find(s => s.seat_number === seatNumber);
    if (targetSeat?.is_locked) return socket.emit('seat:error', 'Seat is locked');
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

  // HOST: INVITE USER TO SEAT
  socket.on('host:invite', async ({ roomId, userId, seatNumber }) => {
    if (!(await isHostOrAdmin(roomId, socket.user.id))) return;
    io.to(roomId).emit('seat:invite', { userId, seatNumber, from: socket.user.username });
  });

  // HOST: MUTE A SEAT
  socket.on('host:mute_seat', async ({ roomId, seatNumber, muted }) => {
    if (!(await isHostOrAdmin(roomId, socket.user.id))) return;
    await db.query('UPDATE seats SET is_muted=$1 WHERE room_id=$2 AND seat_number=$3',
      [muted, roomId, seatNumber]);
    const seats = await Seat.getSeats(roomId);
    io.to(roomId).emit('room:seats', seats);
    io.to(roomId).emit('seat:force_mute', { seatNumber, muted });
  });

  // HOST: LOCK/UNLOCK A SEAT
  socket.on('host:lock_seat', async ({ roomId, seatNumber, locked }) => {
    if (!(await isHostOrAdmin(roomId, socket.user.id))) return;
    await db.query('UPDATE seats SET is_locked=$1 WHERE room_id=$2 AND seat_number=$3',
      [locked, roomId, seatNumber]);
    const seats = await Seat.getSeats(roomId);
    io.to(roomId).emit('room:seats', seats);
  });

  // HOST: SET AS ADMIN
  socket.on('host:set_admin', async ({ roomId, userId }) => {
    if (!(await isHost(roomId, socket.user.id))) return;
    await db.query(
      'INSERT INTO room_admins (room_id, user_id, appointed_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [roomId, userId, socket.user.id]
    );
    const { rows: admins } = await db.query(
      'SELECT user_id FROM room_admins WHERE room_id=$1', [roomId]
    );
    io.to(roomId).emit('room:admins', admins.map(a => a.user_id));
  });

  // HOST: REMOVE ADMIN
  socket.on('host:remove_admin', async ({ roomId, userId }) => {
    if (!(await isHost(roomId, socket.user.id))) return;
    await db.query('DELETE FROM room_admins WHERE room_id=$1 AND user_id=$2', [roomId, userId]);
    const { rows: admins } = await db.query(
      'SELECT user_id FROM room_admins WHERE room_id=$1', [roomId]
    );
    io.to(roomId).emit('room:admins', admins.map(a => a.user_id));
  });

  // HOST: KICK FROM SEAT
  socket.on('host:kick_seat', async ({ roomId, seatNumber }) => {
    if (!(await isHostOrAdmin(roomId, socket.user.id))) return;
    await db.query(
      'UPDATE seats SET user_id=NULL, is_occupied=false, joined_at=NULL WHERE room_id=$1 AND seat_number=$2',
      [roomId, seatNumber]
    );
    await redis.del(`seats:${roomId}`);
    const seats = await Seat.getSeats(roomId);
    io.to(roomId).emit('room:seats', seats);
  });

  // ROOM SETTINGS UPDATE
  socket.on('room:update_settings', async ({ roomId, name, announcement, password, cover_url }) => {
    if (!(await isHost(roomId, socket.user.id))) return;
    await db.query(
      `UPDATE rooms SET 
        name=COALESCE($1,name), 
        announcement=COALESCE($2,announcement),
        password=COALESCE($3,password),
        cover_url=COALESCE($4,cover_url)
       WHERE id=$5`,
      [name, announcement, password, cover_url, roomId]
    );
    const room = await Room.findById(roomId);
    io.to(roomId).emit('room:settings_updated', room);
  });

  // CHAT MESSAGE
  socket.on('chat:message', ({ roomId, message }) => {
    io.to(roomId).emit('chat:message', {
      userId: socket.user.id,
      username: socket.user.username,
      message,
      timestamp: new Date().toISOString()
    });
  });

  // VOICE MUTE SELF
  socket.on('voice:mute', ({ roomId, muted }) => {
    io.to(roomId).emit('voice:mute', { userId: socket.user.id, muted });
  });

  // DISCONNECT
  socket.on('disconnect', async () => {
    if (socket.currentRoom) {
      await Seat.leaveSeat(socket.currentRoom, socket.user.id);
      const seats = await Seat.getSeats(socket.currentRoom);
      io.to(socket.currentRoom).emit('room:seats', seats);
      io.to(socket.currentRoom).emit('room:user_left', { userId: socket.user.id });
    }
  });
};
