require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { initSocket } = require('./socket');
const authRoutes = require('./routes/auth');
const roomRoutes = require('./routes/rooms');
const userRoutes = require('./routes/users');
const giftRoutes = require('./routes/gifts');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const server = http.createServer(app);

// Support multiple origins: comma-separated CLIENT_URL env var
// e.g. CLIENT_URL=https://heylla.vercel.app,https://heylla.netlify.app
const rawOrigins = process.env.CLIENT_URL || 'http://localhost:5173';
const allowedOrigins = rawOrigins.split(',').map(o => o.trim()).filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
};

const io = new Server(server, {
  cors: corsOptions,
  // Prefer websocket on Railway — polling causes 400s behind Railway's proxy
  transports: ['websocket'],
  allowEIO3: true,
});

app.use(cors(corsOptions));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/users', userRoutes);
app.use('/api/gifts', giftRoutes);

initSocket(io);

// Attach io to app so controllers can emit lobby events
app.set('io', io);

app.use(errorHandler);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
