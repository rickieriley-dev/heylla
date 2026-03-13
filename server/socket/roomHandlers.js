module.exports = (io, socket) => {
  socket.on('voice:offer', ({ roomId, targetId, offer }) => {
    io.to(targetId).emit('voice:offer', {
      from: socket.id,
      offer,
    });
  });

  socket.on('voice:answer', ({ targetId, answer }) => {
    io.to(targetId).emit('voice:answer', {
      from: socket.id,
      answer,
    });
  });

  socket.on('voice:ice', ({ targetId, candidate }) => {
    io.to(targetId).emit('voice:ice', {
      from: socket.id,
      candidate,
    });
  });

  socket.on('voice:mute', ({ roomId, muted }) => {
    io.to(String(roomId)).emit('voice:mute', { userId: socket.user.id, muted });
  });
};
