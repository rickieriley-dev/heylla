const roomHandlers = require('./roomHandlers');
const voiceHandlers = require('./voiceHandlers');
const giftHandlers = require('./giftHandlers');
const jwt = require('jsonwebtoken');

const initSocket = (io) => {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Auth required'));
    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch { next(new Error('Invalid token')); }
  });

  io.on('connection', (socket) => {
    roomHandlers(io, socket);
    voiceHandlers(io, socket);
    giftHandlers(io, socket);
  });
};

module.exports = { initSocket };
