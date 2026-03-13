CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  avatar_url TEXT,
  level INT DEFAULT 1,
  coins INT DEFAULT 1000,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE rooms (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  host_id INT REFERENCES users(id),
  tag VARCHAR(50) DEFAULT 'Chatting',
  description TEXT,
  announcement TEXT,
  cover_url TEXT,
  password VARCHAR(255),
  is_locked BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  listener_count INT DEFAULT 0,
  trophy INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE seats (
  id SERIAL PRIMARY KEY,
  room_id INT REFERENCES rooms(id) ON DELETE CASCADE,
  seat_number INT NOT NULL,
  user_id INT REFERENCES users(id),
  is_occupied BOOLEAN DEFAULT false,
  is_locked BOOLEAN DEFAULT false,
  is_muted BOOLEAN DEFAULT false,
  joined_at TIMESTAMP,
  UNIQUE(room_id, seat_number)
);

-- Tracks per-user trophy earnings inside a room (for leaderboard)
CREATE TABLE room_trophies (
  room_id INT REFERENCES rooms(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  amount INT DEFAULT 0,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE room_admins (
  room_id INT REFERENCES rooms(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  appointed_by INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  room_id INT REFERENCES rooms(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE gifts (
  id SERIAL PRIMARY KEY,
  room_id INT REFERENCES rooms(id),
  from_user_id INT REFERENCES users(id),
  to_user_id INT REFERENCES users(id),
  gift_type VARCHAR(50),
  gift_name VARCHAR(100),
  qty INT DEFAULT 1,
  total_cost INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);
