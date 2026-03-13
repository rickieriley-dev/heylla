const Seat = require('../models/Seat');
const Room = require('../models/Room');

module.exports = (io, socket) => {
  socket.on('room:join', async ({ roomId }) => {
    socket.join(roomId);
    socket.currentRoom = roomId;
    const seats = await Seat.getSeats(roomId);
    socket.emit('room:seats', seats);
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

  socket.on('seat:take', async ({ roomId, seatNumber }) => {
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

  socket.on('chat:message', ({ roomId, message }) => {
    io.to(roomId).emit('chat:message', {
      userId: socket.user.id,
      username: socket.user.username,
      message,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('disconnect', async () => {
    if (socket.currentRoom) {
      await Seat.leaveSeat(socket.currentRoom, socket.user.id);
      const seats = await Seat.getSeats(socket.currentRoom);
      io.to(socket.currentRoom).emit('room:seats', seats);
      io.to(socket.currentRoom).emit('room:user_left', { userId: socket.user.id });
    }
  });
};
