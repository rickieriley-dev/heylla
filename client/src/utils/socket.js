import { io } from 'socket.io-client';

let socket = null;

export const connectSocket = (token) => {
  // In production, VITE_SOCKET_URL should be set to your Railway backend URL
  // e.g. VITE_SOCKET_URL=https://heylla-production.up.railway.app
  // In dev, leave it empty and vite proxy handles it
  const url = import.meta.env.VITE_SOCKET_URL || '';

  socket = io(url, {
    auth: { token },
    // WebSocket only — no polling fallback
    // Railway + Node.js supports persistent WebSocket natively
    // Polling is for PHP/Apache only and causes 400 on Railway
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  socket.on('connect_error', (err) => {
    console.error('[Socket] Connection error:', err.message);
  });

  return socket;
};

export const getSocket = () => socket;
export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
