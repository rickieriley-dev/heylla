import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import api from '../utils/api';
import { getLocalStream, createPeer, removePeer, getPeer } from '../utils/webrtc';

const GIFTS = [
  { emoji: '🌹', name: 'Rose', cost: 10 },
  { emoji: '💎', name: 'Diamond', cost: 100 },
  { emoji: '🎊', name: 'Confetti', cost: 20 },
  { emoji: '🚀', name: 'Rocket', cost: 50 },
  { emoji: '⭐', name: 'Star', cost: 30 },
  { emoji: '🔥', name: 'Fire', cost: 40 },
  { emoji: '👑', name: 'Crown', cost: 200 },
  { emoji: '🎵', name: 'Music', cost: 15 },
];

export default function RoomPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const socket = useSocket();
  const navigate = useNavigate();

  const [room, setRoom] = useState(null);
  const [seats, setSeats] = useState([]);
  const [messages, setMessages] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [muted, setMuted] = useState(false);
  const [roomMuted, setRoomMuted] = useState(false);
  const [floatingGifts, setFloatingGifts] = useState([]);
  const [chatInput, setChatInput] = useState('');

  // Modals
  const [showGiftModal, setShowGiftModal] = useState(false);
  const [giftTarget, setGiftTarget] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdmins, setShowAdmins] = useState(false);
  const [showSeatMenu, setShowSeatMenu] = useState(null); // seat object
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteSeatNum, setInviteSeatNum] = useState(null);

  // Settings form
  const [settingsForm, setSettingsForm] = useState({ name: '', announcement: '', password: '' });

  const streamRef = useRef(null);
  const chatRef = useRef(null);

  const isHost = room?.host_id === user?.id;
  const isAdmin = admins.includes(user?.id);
  const isHostOrAdmin = isHost || isAdmin;
  const mySeat = seats.find(s => s.user_id === user?.id);

  useEffect(() => {
    api.get(`/rooms/${id}`).then(r => {
      setRoom(r.data);
      setSeats(r.data.seats || []);
      setSettingsForm({ name: r.data.name || '', announcement: r.data.announcement || '', password: '' });
    });
  }, [id]);

  useEffect(() => {
    if (!socket || !id) return;
    socket.emit('room:join', { roomId: id });

    socket.on('room:seats', setSeats);
    socket.on('room:info', ({ room: r, admins: a }) => {
      setRoom(r);
      setAdmins(a);
    });
    socket.on('room:admins', setAdmins);
    socket.on('room:settings_updated', (r) => {
      setRoom(r);
      setSettingsForm({ name: r.name || '', announcement: r.announcement || '', password: '' });
    });
    socket.on('chat:message', (msg) => {
      setMessages(prev => [...prev.slice(-100), msg]);
      setTimeout(() => chatRef.current?.scrollTo(0, 9999), 50);
    });
    socket.on('gift:received', ({ from, giftType }) => {
      const g = { id: Date.now(), emoji: giftType, from: from.username };
      setFloatingGifts(prev => [...prev, g]);
      setTimeout(() => setFloatingGifts(prev => prev.filter(x => x.id !== g.id)), 2500);
    });
    socket.on('seat:invite', ({ userId, seatNumber }) => {
      if (userId === user?.id) {
        if (window.confirm(`You've been invited to seat ${seatNumber}! Accept?`)) {
          socket.emit('seat:take', { roomId: id, seatNumber });
        }
      }
    });
    socket.on('seat:force_mute', ({ seatNumber, muted: m }) => {
      if (mySeat?.seat_number === seatNumber) {
        streamRef.current?.getAudioTracks().forEach(t => { t.enabled = !m; });
        setMuted(m);
      }
    });
    socket.on('voice:offer', async ({ from, offer }) => {
      if (!streamRef.current) return;
      const pc = createPeer(from, streamRef.current,
        (tid, stream) => attachAudio(tid, stream),
        (tid, candidate) => socket.emit('voice:ice', { targetId: tid, candidate })
      );
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('voice:answer', { targetId: from, answer });
    });
    socket.on('voice:answer', async ({ from, answer }) => {
      await getPeer(from)?.setRemoteDescription(answer);
    });
    socket.on('voice:ice', async ({ from, candidate }) => {
      await getPeer(from)?.addIceCandidate(candidate);
    });
    socket.on('voice:mute', ({ userId: uid, muted: m }) => {
      setSeats(prev => prev.map(s => s.user_id === uid ? { ...s, _muted: m } : s));
    });

    return () => {
      socket.emit('room:leave', { roomId: id });
      ['room:seats','room:info','room:admins','room:settings_updated','chat:message',
       'gift:received','seat:invite','seat:force_mute','voice:offer','voice:answer',
       'voice:ice','voice:mute'].forEach(e => socket.off(e));
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [socket, id]);

  const attachAudio = (peerId, stream) => {
    let audio = document.getElementById(`audio-${peerId}`);
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = `audio-${peerId}`;
      audio.autoplay = true;
      document.body.appendChild(audio);
    }
    audio.srcObject = stream;
  };

  const takeSeat = (seat) => {
    if (seat.is_locked && !isHostOrAdmin) return;
    if (seat.is_occupied && seat.user_id !== user?.id) {
      // Show seat menu if host/admin
      if (isHostOrAdmin) setShowSeatMenu(seat);
      return;
    }
    if (seat.user_id === user?.id) {
      socket.emit('seat:leave', { roomId: id });
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    } else {
      socket.emit('seat:take', { roomId: id, seatNumber: seat.seat_number });
      startVoice();
    }
  };

  const startVoice = async () => {
    try {
      streamRef.current = await getLocalStream();
    } catch (err) { console.warn('No mic:', err); }
  };

  const toggleMute = () => {
    if (!mySeat) return;
    const newMuted = !muted;
    streamRef.current?.getAudioTracks().forEach(t => { t.enabled = !newMuted; });
    setMuted(newMuted);
    socket.emit('voice:mute', { roomId: id, muted: newMuted });
  };

  const toggleRoomMute = () => setRoomMuted(m => !m);

  const sendGift = (gift) => {
    socket.emit('gift:send', { roomId: id, giftType: gift.emoji, targetUserId: giftTarget?.user_id });
    setShowGiftModal(false);
    setGiftTarget(null);
  };

  const sendChat = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    socket.emit('chat:message', { roomId: id, message: chatInput });
    setChatInput('');
  };

  const saveSettings = () => {
    socket.emit('room:update_settings', { roomId: id, ...settingsForm });
    setShowSettings(false);
  };

  // HOST ACTIONS
  const hostMuteSeat = (seat, muted) => {
    socket.emit('host:mute_seat', { roomId: id, seatNumber: seat.seat_number, muted });
    setShowSeatMenu(null);
  };
  const hostLockSeat = (seat, locked) => {
    socket.emit('host:lock_seat', { roomId: id, seatNumber: seat.seat_number, locked });
    setShowSeatMenu(null);
  };
  const hostSetAdmin = (userId) => {
    socket.emit('host:set_admin', { roomId: id, userId });
    setShowAdmins(false);
  };
  const hostRemoveAdmin = (userId) => {
    socket.emit('host:remove_admin', { roomId: id, userId });
  };
  const hostInvite = (seatNumber) => {
    setInviteSeatNum(seatNumber);
    setShowInviteModal(true);
    setShowSeatMenu(null);
  };

  const occupiedSeats = seats.filter(s => s.is_occupied);

  return (
    <div className="room-page">
      {/* HEADER */}
      <div className="room-header">
        <button className="back-btn" onClick={() => navigate('/')}>←</button>
        <div className="room-user">
          <div className="room-avatar">{user?.username?.[0]?.toUpperCase()}</div>
          <div>
            <div className="room-username">{user?.username}</div>
            <div className="room-uid">ID:{user?.id?.toString().slice(0,6)}</div>
          </div>
        </div>
        <div className="room-right">
          <span className="trophy-badge">🏆 0</span>
          {isHost && (
            <button className="icon-btn" onClick={() => setShowSettings(true)} title="Room Settings">⚙️</button>
          )}
          <button className="icon-btn" onClick={() => navigate('/')}>⏻</button>
        </div>
      </div>

      {/* ROOM NAME + ANNOUNCEMENT */}
      <div className="room-lv-row">
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span className="lv-badge">LV0</span>
          <span style={{fontSize:13,fontWeight:600,color:'#fff'}}>{room?.name}</span>
        </div>
        <span className="listener-count">👥 {occupiedSeats.length}</span>
      </div>
      {room?.announcement && (
        <div className="room-announcement">📢 {room.announcement}</div>
      )}

      {/* SEATS GRID */}
      <div className="seats-grid">
        {seats.map(seat => (
          <div key={seat.seat_number} className="seat" onClick={() => takeSeat(seat)}>
            <div className={`seat-circle 
              ${seat.is_occupied ? 'occupied' : ''} 
              ${seat.user_id === user?.id ? 'mine' : ''}
              ${seat.is_locked ? 'locked' : ''}
              ${seat.is_muted ? 'seat-muted' : ''}`}>
              {seat.is_locked && !seat.is_occupied ? '🔒' :
               seat.is_occupied ? (seat.username?.[0]?.toUpperCase() || '🧑') : '🎙️'}
              {seat.is_muted && seat.is_occupied && <span className="mute-badge">🔇</span>}
            </div>
            <div className="seat-num">{seat.seat_number}</div>
            {seat.username && <div className="seat-name">{seat.username}</div>}
            {admins.includes(seat.user_id) && <div className="admin-badge">Admin</div>}
            {room?.host_id === seat.user_id && <div className="host-badge">Host</div>}
          </div>
        ))}
      </div>

      {/* CHAT */}
      <div className="chat-box" ref={chatRef}>
        <p className="chat-system">Welcome to {room?.name}! {room?.announcement || 'Please be respectful.'}</p>
        {messages.map((m, i) => (
          <p key={i} className="chat-msg">
            <span className="chat-user">{m.username}:</span> {m.message}
          </p>
        ))}
      </div>

      {/* FLOATING GIFTS */}
      {floatingGifts.map(g => (
        <div key={g.id} className="floating-gift" style={{ left: `${20 + Math.random()*60}%` }}>
          {g.emoji}
        </div>
      ))}

      {/* BOTTOM CONTROLS */}
      <div className="room-bottom">
        <form onSubmit={sendChat} className="chat-form">
          <input placeholder="Say something..." value={chatInput}
            onChange={e => setChatInput(e.target.value)} className="chat-input" />
        </form>

        {/* GIFT BUTTON */}
        <button className="gift-btn" onClick={() => setShowGiftModal(true)}>🎁</button>

        {/* MUTE SELF */}
        <button className={`mic-btn ${muted ? 'muted' : ''}`} onClick={toggleMute} disabled={!mySeat}>
          {muted ? '🔇' : '🎤'}
        </button>

        {/* ROOM MUTE */}
        <button className={`mic-btn ${roomMuted ? 'muted' : ''}`} onClick={toggleRoomMute} title="Mute Room">
          {roomMuted ? '🔕' : '🔔'}
        </button>
      </div>

      {/* ===== GIFT MODAL ===== */}
      {showGiftModal && (
        <div className="modal-overlay" onClick={() => setShowGiftModal(false)}>
          <div className="modal gift-modal" onClick={e => e.stopPropagation()}>
            <h2>🎁 Send Gift</h2>
            <div className="gift-target-row">
              <span>To: </span>
              <select onChange={e => {
                const seat = seats.find(s => s.user_id === parseInt(e.target.value));
                setGiftTarget(seat);
              }} defaultValue="">
                <option value="">Anyone in room</option>
                {seats.filter(s => s.is_occupied).map(s => (
                  <option key={s.user_id} value={s.user_id}>
                    {s.username} {s.user_id === user?.id ? '(You)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="gift-grid">
              {GIFTS.map(g => (
                <button key={g.emoji} className="gift-item" onClick={() => sendGift(g)}>
                  <span className="gift-emoji">{g.emoji}</span>
                  <span className="gift-name">{g.name}</span>
                  <span className="gift-cost">🪙{g.cost}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== SEAT CONTEXT MENU (Host/Admin) ===== */}
      {showSeatMenu && (
        <div className="modal-overlay" onClick={() => setShowSeatMenu(null)}>
          <div className="modal seat-menu" onClick={e => e.stopPropagation()}>
            <h2>Seat {showSeatMenu.seat_number}</h2>
            {showSeatMenu.username && <p className="seat-menu-user">👤 {showSeatMenu.username}</p>}
            <div className="seat-menu-actions">
              {showSeatMenu.is_occupied ? (
                <>
                  <button onClick={() => hostMuteSeat(showSeatMenu, !showSeatMenu.is_muted)}>
                    {showSeatMenu.is_muted ? '🔊 Unmute' : '🔇 Mute'}
                  </button>
                  {isHost && showSeatMenu.user_id !== user?.id && (
                    <button onClick={() => hostSetAdmin(showSeatMenu.user_id)}>
                      ⭐ Set as Admin
                    </button>
                  )}
                </>
              ) : (
                <button onClick={() => hostInvite(showSeatMenu.seat_number)}>
                  📨 Invite User
                </button>
              )}
              <button onClick={() => hostLockSeat(showSeatMenu, !showSeatMenu.is_locked)}>
                {showSeatMenu.is_locked ? '🔓 Unlock Seat' : '🔒 Lock Seat'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== ROOM SETTINGS MODAL ===== */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal settings-modal" onClick={e => e.stopPropagation()}>
            <h2>⚙️ Room Settings</h2>
            <div className="settings-form">
              <label>Room Name</label>
              <input value={settingsForm.name}
                onChange={e => setSettingsForm({...settingsForm, name: e.target.value})}
                placeholder="Room name" />
              <label>Announcement</label>
              <textarea value={settingsForm.announcement}
                onChange={e => setSettingsForm({...settingsForm, announcement: e.target.value})}
                placeholder="Welcome message for new joiners..." rows={3} />
              <label>Room Password (leave blank to remove)</label>
              <input type="password" value={settingsForm.password}
                onChange={e => setSettingsForm({...settingsForm, password: e.target.value})}
                placeholder="Set room password..." />
              <div className="settings-btns">
                <button className="btn-secondary" onClick={() => setShowAdmins(true)}>👑 Manage Admins</button>
                <button className="btn-primary" onClick={saveSettings}>Save Settings</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== ADMINS MODAL ===== */}
      {showAdmins && (
        <div className="modal-overlay" onClick={() => setShowAdmins(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>👑 Room Admins</h2>
            {admins.length === 0 && <p style={{color:'#888',fontSize:13,margin:'12px 0'}}>No admins yet.</p>}
            {seats.filter(s => s.is_occupied && admins.includes(s.user_id)).map(s => (
              <div key={s.user_id} className="admin-row">
                <span>⭐ {s.username}</span>
                <button onClick={() => hostRemoveAdmin(s.user_id)}>Remove</button>
              </div>
            ))}
            <p style={{fontSize:12,color:'#aaa',marginTop:12}}>
              To set an admin, long-press a seat with an occupied user.
            </p>
          </div>
        </div>
      )}

      {/* ===== INVITE MODAL ===== */}
      {showInviteModal && (
        <div className="modal-overlay" onClick={() => setShowInviteModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>📨 Invite to Seat {inviteSeatNum}</h2>
            <p style={{fontSize:13,color:'#888',margin:'8px 0 16px'}}>Select a user to invite to this seat:</p>
            {seats.filter(s => !s.is_occupied).length === 0 && (
              <p style={{color:'#aaa',fontSize:13}}>All users already on mic.</p>
            )}
            {/* Show online users not on a seat - simplified: show all occupied room users */}
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {seats.filter(s => s.is_occupied && s.user_id !== user?.id).map(s => (
                <button key={s.user_id} className="btn-secondary" onClick={() => {
                  socket.emit('host:invite', { roomId: id, userId: s.user_id, seatNumber: inviteSeatNum });
                  setShowInviteModal(false);
                }}>
                  {s.username}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
