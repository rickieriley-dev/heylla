import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';

const TAGS = { Singing: '#f97316', 'Making Friends': '#a855f7', Chatting: '#0ea5e9', Gaming: '#22c55e' };

export default function HomePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);
  const [tab, setTab] = useState('My');
  const [showCreate, setShowCreate] = useState(false);
  const [newRoom, setNewRoom] = useState({ name: '', tag: 'Chatting', description: '' });

  useEffect(() => {
    api.get('/rooms').then(r => setRooms(r.data)).catch(console.error);
  }, []);

  const createRoom = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post('/rooms', newRoom);
      navigate(`/room/${data.id}`);
    } catch (err) { alert(err.response?.data?.error || 'Failed'); }
  };

  return (
    <div className="home-page">
      <div className="home-top">
        <div className="home-avatar" onClick={logout}>
          {user?.avatar_url ? <img src={user.avatar_url} alt="" /> : user?.username?.[0]?.toUpperCase()}
        </div>
        <h1 className="home-title">Party</h1>
        <div className="home-notif">📋</div>
      </div>

      <div className="home-tabs">
        {['My','Hot','New'].map(t => (
          <button key={t} className={`tab-btn ${tab===t?'active':''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
        <div className="tab-search">🔍 Search</div>
      </div>

      <div className="room-list">
        {rooms.length === 0 && <p className="no-rooms">No rooms yet. Create one!</p>}
        {rooms.map(room => (
          <div key={room.id} className="room-card" onClick={() => navigate(`/room/${room.id}`)}>
            <div className="room-thumb">{room.name?.[0]?.toUpperCase() || '🎙'}</div>
            <div className="room-info">
              <div className="room-flag-name">
                <span>🇵🇭</span>
                <span className="room-name">{room.name}</span>
              </div>
              <span className="room-tag" style={{ background: TAGS[room.tag] || '#888' }}>
                {room.tag}
              </span>
              <p className="room-desc">{room.description}</p>
            </div>
            <div className="room-stat">📶 {room.listener_count || 0}</div>
          </div>
        ))}
      </div>

      <div className="home-join">
        <button className="join-btn" onClick={() => setShowCreate(true)}>🎉 Create Room</button>
      </div>

      <nav className="bottom-nav">
        <span className="nav-active">🏠</span>
        <span>▶️</span><span>💗</span><span>👤</span><span>💬</span>
      </nav>

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Create Room</h2>
            <form onSubmit={createRoom}>
              <input placeholder="Room name" value={newRoom.name}
                onChange={e => setNewRoom({...newRoom, name: e.target.value})} required />
              <select value={newRoom.tag} onChange={e => setNewRoom({...newRoom, tag: e.target.value})}>
                {Object.keys(TAGS).map(t => <option key={t}>{t}</option>)}
              </select>
              <input placeholder="Description" value={newRoom.description}
                onChange={e => setNewRoom({...newRoom, description: e.target.value})} />
              <button type="submit">Create</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
