import { io } from 'socket.io-client';

let socket = null;

export const connectSocket = (token) => {
  socket = io(import.meta.env.VITE_SOCKET_URL || '', {
    auth: { token }
  });
  return socket;
};

export const getSocket = () => socket;
export const disconnectSocket = () => { if (socket) socket.disconnect(); };
