import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import api from '../utils/api';
import { getLocalStream, createPeer, removePeer } from '../utils/webrtc';

const GIFTS = ['🌹','💎','🎊','🚀','⭐','🔥','👑'];

export default function RoomPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const socket = useSocket();
  const navigate = useNavigate();
  const [room, setRoom] = useState(null);
  const [seats, setSeats] = useState([]);
  const [messages, setMessages] = useState([]);
  const [muted, setMuted] = useState(false);
  const [floatingGifts, setFloatingGifts] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const streamRef = useRef(null);
  const chatRef = useRef(null);

  useEffect(() => {
    api.get(`/rooms/${id}`).then(r => {
      setRoom(r.data);
      setSeats(r.data.seats || []);
    });
  }, [id]);

  useEffect(() => {
    if (!socket || !id) return;
    socket.emit('room:join', { roomId: id });

    socket.on('room:seats', setSeats);
    socket.on('chat:message', (msg) => {
      setMessages(prev => [...prev.slice(-50), msg]);
      setTimeout(() => chatRef.current?.scrollTo(0, 9999), 50);
    });
    socket.on('gift:received', ({ from, giftType }) => {
      const g = { id: Date.now(), emoji: giftType, from: from.username };
      setFloatingGifts(prev => [...prev, g]);
      setTimeout(() => setFloatingGifts(prev => prev.filter(x => x.id !== g.id)), 2500);
    });
    socket.on('voice:offer', async ({ from, offer }) => {
      if (!streamRef.current) return;
      const pc = createPeer(from, streamRef.current,
        (tid, stream) => { /* attach stream to audio element */ },
        (tid, candidate) => socket.emit('voice:ice', { targetId: tid, candidate })
      );
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('voice:answer', { targetId: from, answer });
    });
    socket.on('voice:answer', async ({ from, answer }) => {
      const { getPeer } = await import('../utils/webrtc');
      await getPeer(from)?.setRemoteDescription(answer);
    });
    socket.on('voice:ice', async ({ from, candidate }) => {
      const { getPeer } = await import('../utils/webrtc');
      await getPeer(from)?.addIceCandidate(candidate);
    });

    return () => {
      socket.emit('room:leave', { roomId: id });
      socket.off('room:seats');
      socket.off('chat:message');
      socket.off('gift:received');
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [socket, id]);

  const takeSeat = (seatNum) => {
    const seat = seats.find(s => s.seat_number === seatNum);
    if (seat?.is_occupied && seat.user_id !== user?.id) return;
    if (seat?.user_id === user?.id) {
      socket.emit('seat:leave', { roomId: id });
    } else {
      socket.emit('seat:take', { roomId: id, seatNumber: seatNum });
      startVoice();
    }
  };

  const startVoice = async () => {
    try {
      streamRef.current = await getLocalStream();
    } catch (err) { console.warn('No mic access:', err); }
  };

  const toggleMute = () => {
    streamRef.current?.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
    setMuted(m => !m);
    socket.emit('voice:mute', { roomId: id, muted: !muted });
  };

  const sendGift = () => {
    const emoji = GIFTS[Math.floor(Math.random() * GIFTS.length)];
    socket.emit('gift:send', { roomId: id, giftType: emoji });
  };

  const sendChat = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    socket.emit('chat:message', { roomId: id, message: chatInput });
    setChatInput('');
  };

  const mySeat = seats.find(s => s.user_id === user?.id);

  return (
    <div className="room-page">
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
          <button className="icon-btn" onClick={() => navigate('/')}>⏻</button>
        </div>
      </div>

      <div className="room-lv-row">
        <span className="lv-badge">LV0</span>
        <span className="listener-count">👥 {seats.filter(s=>s.is_occupied).length}</span>
      </div>

      <div className="seats-grid">
        {seats.map(seat => (
          <div key={seat.seat_number} className="seat" onClick={() => takeSeat(seat.seat_number)}>
            <div className={`seat-circle ${seat.is_occupied ? 'occupied' : ''} ${seat.user_id === user?.id ? 'mine' : ''}`}>
              {seat.is_occupied ? (seat.username?.[0]?.toUpperCase() || '🧑') : '🛋️'}
            </div>
            <div className="seat-num">{seat.seat_number}</div>
            {seat.username && <div className="seat-name">{seat.username}</div>}
          </div>
        ))}
      </div>

      <div className="chat-box" ref={chatRef}>
        <p className="chat-system">Welcome to {room?.name}! Please be respectful.</p>
        {messages.map((m, i) => (
          <p key={i} className="chat-msg">
            <span className="chat-user">{m.username}:</span> {m.message}
          </p>
        ))}
      </div>

      {floatingGifts.map(g => (
        <div key={g.id} className="floating-gift" style={{ left: `${20 + Math.random()*60}%` }}>
          {g.emoji}
        </div>
      ))}

      <div className="room-bottom">
        <form onSubmit={sendChat} className="chat-form">
          <input placeholder="Say something..." value={chatInput}
            onChange={e => setChatInput(e.target.value)} className="chat-input" />
        </form>
        <button className="gift-btn" onClick={sendGift}>🎁</button>
        <button className={`mic-btn ${muted ? 'muted' : ''}`} onClick={toggleMute}
          disabled={!mySeat}>
          {muted ? '🔇' : '🎤'}
        </button>
      </div>
    </div>
  );
}
