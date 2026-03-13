# 🎙 Heylla - Party Voice Chat

Heylla-inspired group voice chat web app.

## Tech Stack
- **Frontend**: React.js + Vite
- **Backend**: Node.js + Express
- **Real-time**: Socket.io
- **Voice**: WebRTC
- **Database**: PostgreSQL
- **Cache**: Redis

## Quick Start

### 1. Setup Database
```bash
psql -U postgres -c "CREATE DATABASE heylla;"
psql -U postgres -d heylla -f server/config/schema.sql
```

### 2. Server
```bash
cd server
cp .env.example .env   # Fill in your values
npm install
npm run dev
```

### 3. Client
```bash
cd client
cp .env.example .env
npm install
npm run dev
```

### 4. Open Browser
Go to http://localhost:5173

## Features
- ✅ User registration & login (JWT)
- ✅ Create & browse party rooms
- ✅ 10-seat room layout (Heylla-style)
- ✅ Real-time chat via Socket.io
- ✅ Gift sending with animations
- ✅ WebRTC voice audio
- ✅ Mute/unmute mic

## Deployment
- Frontend: Vercel / Netlify
- Backend: Railway / Render
- Database: Supabase / Neon (free PostgreSQL)
- Redis: Upstash (free Redis)
