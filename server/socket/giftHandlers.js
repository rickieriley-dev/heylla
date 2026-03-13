module.exports = (io, socket) => {
  socket.on('gift:send', ({ roomId, giftType, targetUserId }) => {
    io.to(roomId).emit('gift:received', {
      from: { id: socket.user.id, username: socket.user.username },
      to: targetUserId,
      giftType,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('reaction:send', ({ roomId, emoji }) => {
    io.to(roomId).emit('reaction:received', {
      userId: socket.user.id,
      username: socket.user.username,
      emoji
    });
  });
};
