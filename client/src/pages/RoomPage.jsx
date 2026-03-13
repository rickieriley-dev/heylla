import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import api from '../utils/api';
import { getLocalStream, createPeer, removePeer, getPeer } from '../utils/webrtc';

const GIFTS = [
  { emoji: '👏', name: 'Applaud',  cost: 500  },
  { emoji: '🌹', name: 'Rose',     cost: 1000 },
  { emoji: '💎', name: 'Diamond',  cost: 5000 },
  { emoji: '🎊', name: 'Confetti', cost: 800  },
  { emoji: '🚀', name: 'Rocket',   cost: 3000 },
  { emoji: '⭐', name: 'Star',     cost: 1500 },
  { emoji: '🔥', name: 'Fire',     cost: 2000 },
  { emoji: '👑', name: 'Crown',    cost: 10000},
  { emoji: '🎵', name: 'Music',    cost: 600  },
  { emoji: '🍀', name: 'Lucky',    cost: 400  },
  { emoji: '🎁', name: 'Gift',     cost: 700  },
  { emoji: '💕', name: 'Love',     cost: 900  },
];

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

export default function RoomPage() {
  const { id: roomId } = useParams();
  const { user } = useAuth();
  const socket = useSocket();
  const navigate = useNavigate();

  const [room, setRoom]           = useState(null);
  const [seats, setSeats]         = useState([]);
  const [messages, setMessages]   = useState([]);
  const [admins, setAdmins]       = useState([]);
  const [muted, setMuted]         = useState(false);
  const [volOn, setVolOn]         = useState(true);
  const [floatGifts, setFloatGifts] = useState([]);

  // Sheets
  const [sheet, setSheet]         = useState(null); // 'mic'|'gift'|'settings'|'leaderboard'|'invite'|'profile'|'admins'
  const [activeSeat, setActiveSeat] = useState(null);
  const [profileUser, setProfileUser] = useState(null);
  const [giftRecipient, setGiftRecipient] = useState(null);

  // Gift state
  const [selGift, setSelGift]     = useState(GIFTS[0]);
  const [giftQty, setGiftQty]     = useState(1);

  // Settings form
  const [sfName, setSfName]       = useState('');
  const [sfAnn, setSfAnn]         = useState('');
  const [sfPass, setSfPass]       = useState('');

  // Chat
  const [chatInput, setChatInput] = useState('');
  const chatRef = useRef(null);
  const streamRef = useRef(null);
  const sendingGift = useRef(false);

  const isHost        = room?.host_id === user?.id;
  const isAdmin       = admins.includes(user?.id);
  const isHostOrAdmin = isHost || isAdmin;
  const mySeat        = seats.find(s => s.user_id === user?.id);
  const occupiedSeats = seats.filter(s => s.is_occupied);

  // ── Socket events ──────────────────────────────────────────────
  useEffect(() => {
    if (!socket || !roomId) return;
    socket.emit('room:join', { roomId });

    socket.on('room:seats', setSeats);
    socket.on('room:info', ({ room: r, admins: a }) => {
      setRoom(r);
      setAdmins(a || []);
      setSfName(r.name || '');
      setSfAnn(r.announcement || '');
    });
    socket.on('room:admins', setAdmins);
    socket.on('room:settings_updated', (r) => {
      setRoom(r); setSfName(r.name || ''); setSfAnn(r.announcement || '');
    });
    socket.on('chat:message', (msg) => {
      setMessages(prev => [...prev.slice(-100), msg]);
      setTimeout(() => { if(chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, 50);
    });
    socket.on('gift:received', ({ from, giftType }) => {
      const g = { id: Date.now() + Math.random(), emoji: giftType, from: from.username };
      setFloatGifts(prev => [...prev, g]);
      setTimeout(() => setFloatGifts(prev => prev.filter(x => x.id !== g.id)), 2500);
    });
    socket.on('seat:invite', ({ userId, seatNumber, from }) => {
      if (userId === user?.id) {
        if (window.confirm(`${from} invited you to Mic ${seatNumber}! Accept?`)) {
          socket.emit('seat:take', { roomId, seatNumber });
          startVoice();
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
    socket.on('voice:answer', async ({ from, answer }) => { await getPeer(from)?.setRemoteDescription(answer); });
    socket.on('voice:ice',    async ({ from, candidate }) => { await getPeer(from)?.addIceCandidate(candidate); });
    socket.on('voice:mute',   ({ userId: uid, muted: m }) => {
      setSeats(prev => prev.map(s => s.user_id === uid ? { ...s, _muted: m } : s));
    });

    return () => {
      socket.emit('room:leave', { roomId });
      ['room:seats','room:info','room:admins','room:settings_updated','chat:message',
       'gift:received','seat:invite','seat:force_mute','voice:offer','voice:answer',
       'voice:ice','voice:mute'].forEach(e => socket.off(e));
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [socket, roomId]);

  const attachAudio = (peerId, stream) => {
    let audio = document.getElementById(`audio-${peerId}`);
    if (!audio) { audio = document.createElement('audio'); audio.id = `audio-${peerId}`; audio.autoplay = true; document.body.appendChild(audio); }
    audio.srcObject = stream;
  };

  const startVoice = async () => {
    try { streamRef.current = await getLocalStream(); } catch(e) { console.warn('No mic:', e); }
  };

  // ── Seat click ──────────────────────────────────────────────────
  const onSeatClick = (seat) => {
    if (seat.is_occupied) {
      if (seat.user_id === user?.id) {
        setActiveSeat(seat); setSheet('mic');
      } else {
        setProfileUser({ userId: seat.user_id, username: seat.username, seatNum: seat.seat_number });
        setSheet('profile');
      }
    } else {
      if (isHostOrAdmin) { setActiveSeat(seat); setSheet('mic'); }
      else { setActiveSeat(seat); setSheet('mic'); }
    }
  };

  const takeMic = () => {
    if (!activeSeat) return;
    if (activeSeat.is_locked && !isHostOrAdmin) { addMsg('🔒 This mic is locked.'); closeSheet(); return; }
    socket.emit('seat:take', { roomId, seatNumber: activeSeat.seat_number });
    startVoice();
    closeSheet();
  };

  const leaveMic = () => {
    socket.emit('seat:leave', { roomId });
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    closeSheet();
  };

  const hostInviteToSeat = (seatNum) => {
    setActiveSeat(seats.find(s => s.seat_number === seatNum));
    setSheet('invite');
  };

  const sendInvite = (targetUserId) => {
    socket.emit('host:invite', { roomId, userId: targetUserId, seatNumber: activeSeat?.seat_number });
    addMsg('📨 Invite sent!');
    closeSheet();
  };

  const hostMuteSeat = (seat, muted) => {
    socket.emit('host:mute_seat', { roomId, seatNumber: seat.seat_number, muted });
    closeSheet();
  };

  const hostLockSeat = (seat, locked) => {
    socket.emit('host:lock_seat', { roomId, seatNumber: seat.seat_number, locked });
    closeSheet();
  };

  const hostSetAdmin = (userId) => {
    socket.emit('host:set_admin', { roomId, userId });
    closeSheet();
  };

  const hostRemoveAdmin = (userId) => socket.emit('host:remove_admin', { roomId, userId });

  // ── Chat ────────────────────────────────────────────────────────
  const sendChat = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    socket.emit('chat:message', { roomId, message: chatInput });
    setChatInput('');
  };

  const addMsg = (text) => {
    setMessages(prev => [...prev, { username: 'System', message: text, type: 's', timestamp: new Date().toISOString() }]);
  };

  // ── Mic toggle ──────────────────────────────────────────────────
  const toggleMic = () => {
    if (!mySeat) return;
    const next = !muted;
    streamRef.current?.getAudioTracks().forEach(t => { t.enabled = !next; });
    setMuted(next);
    socket.emit('voice:mute', { roomId, muted: next });
  };

  // ── Gift ────────────────────────────────────────────────────────
  const openGift = (recipient) => { setGiftRecipient(recipient || null); setSheet('gift'); };
  const sendGift = () => {
    if (sendingGift.current) return;
    sendingGift.current = true;
    const target = giftRecipient;
    socket.emit('gift:send', { roomId, giftType: selGift.emoji, targetUserId: target?.user_id });
    addMsg(`🎁 You sent ${selGift.emoji} ${selGift.name}${target ? ' to ' + target.username : ''}!`);
    closeSheet();
    setTimeout(() => { sendingGift.current = false; }, 500);
  };

  // ── Settings ────────────────────────────────────────────────────
  const saveSettings = () => {
    socket.emit('room:update_settings', { roomId, name: sfName, announcement: sfAnn, password: sfPass || undefined });
    addMsg('⚙️ Settings saved!');
    closeSheet();
  };

  const closeSheet = () => setSheet(null);

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className="lv-page">
      {/* BACKGROUND */}
      <div className="lv-bg">
        <div className="lv-bg-grad"></div>
        <div className="lv-stars"></div>
        <div className="lv-orb o1"></div>
        <div className="lv-orb o2"></div>
        <div className="lv-orb o3"></div>
        <div className="lv-ground"></div>
        <div className="lv-silhouette">
          <svg viewBox="0 0 480 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0,80 L0,55 L20,55 L20,40 L30,40 L30,30 L40,30 L40,40 L50,40 L50,20 L55,15 L60,20 L60,40 L70,40 L70,55 L90,55 L90,45 L100,45 L100,35 L108,35 L108,45 L120,45 L120,55 L140,55 L140,42 L148,38 L155,42 L155,55 L170,55 L170,30 L178,22 L186,30 L186,55 L200,55 L200,48 L210,48 L210,38 L218,32 L226,38 L226,48 L240,48 L240,55 L260,55 L260,40 L268,33 L276,40 L276,55 L300,55 L300,45 L310,40 L320,45 L320,55 L340,55 L340,48 L350,42 L360,48 L360,55 L380,55 L380,35 L388,28 L396,35 L396,55 L420,55 L420,48 L430,44 L440,48 L440,55 L460,55 L460,50 L470,46 L480,50 L480,80 Z" fill="#080812" opacity="0.9"/>
          </svg>
        </div>
      </div>

      {/* TOP BAR */}
      <div className="lv-topbar">
        <div className="lv-tl">
          <div className="lv-room-ava">{room?.cover_url ? <img src={room.cover_url} alt=""/> : (room?.name?.[0] || '🌙')}</div>
          <div>
            <div className="lv-room-title">{room?.name || 'Loading...'}</div>
            <div className="lv-room-id">ID:{roomId}</div>
          </div>
        </div>
        <div className="lv-coins-pill">🏆 {occupiedSeats.length * 100}</div>
        <div className="lv-tr">
          <div className="lv-vpill">👥 <span>{occupiedSeats.length}</span></div>
          {isHost && <div className="lv-tbtn" onClick={() => setSheet('settings')}>⚙️</div>}
          <div className="lv-tbtn" onClick={() => navigate('/')}>⏻</div>
        </div>
      </div>

      {/* MIC SLOTS */}
      <div className="lv-mics-wrap">
        <div className="lv-mics-grid">
          {seats.map(seat => {
            const occupied = seat.is_occupied;
            const isMe = seat.user_id === user?.id;
            const isHostSeat = seat.user_id === room?.host_id;
            const isAdminSeat = admins.includes(seat.user_id);
            return (
              <div key={seat.seat_number} className={`lv-mic-slot${occupied ? ' occupied' : ''}${seat.is_locked ? ' locked' : ''}`}
                data-slot={seat.seat_number} onClick={() => onSeatClick(seat)}>
                <div className={`lv-mic-ring${occupied ? ' ring-occ' : ''}${isMe ? ' speaking' : ''}${isAdminSeat && !isHostSeat ? ' admin-ring' : ''}`}>
                  {occupied ? (
                    <div className="lv-ava-fill" style={{background: isHostSeat ? 'linear-gradient(135deg,#a78bfa,#f472b6)' : 'linear-gradient(135deg,#34d399,#0891b2)'}}>
                      {seat.avatar_url ? <img src={seat.avatar_url} alt=""/> : (seat.username?.[0]?.toUpperCase() || '👤')}
                    </div>
                  ) : seat.is_locked ? (
                    <span className="lv-mic-ico">🔒</span>
                  ) : (
                    <span className="lv-mic-ico">🎤</span>
                  )}
                  {isHostSeat && <div className="lv-host-tag">👑 Host</div>}
                  {isAdminSeat && !isHostSeat && <div className="lv-admin-tag">⚡Admin</div>}
                </div>
                <div className="lv-mic-label">{occupied ? seat.username : `No.${seat.seat_number}`}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ANNOUNCEMENT */}
      {room?.announcement && (
        <div className="lv-announcement">📢 {room.announcement}</div>
      )}

      {/* CHAT */}
      <div className="lv-chat-wrap" ref={chatRef}>
        <div className="lv-msg lv-sys"><span className="lv-sys-txt">Welcome to {room?.name}! Please be respectful 🌿</span></div>
        {messages.map((m, i) => (
          <div key={i} className={`lv-msg${m.type === 's' ? ' lv-sys' : ''}`}>
            {m.type === 's' ? (
              <span className="lv-sys-txt">{m.message}</span>
            ) : (
              <>
                <div className={`lv-msg-ava${m.userId === room?.host_id ? ' host-ava' : admins.includes(m.userId) ? ' admin-ava' : ''}`}>
                  {m.username?.[0]?.toUpperCase() || '?'}
                </div>
                {admins.includes(m.userId) && <span className="lv-admin-tag-sm">Admin</span>}
                <span className={`lv-msg-name${m.userId === room?.host_id ? ' h' : admins.includes(m.userId) ? ' a' : ' n'}`}>{m.username}</span>
                <span className="lv-msg-txt"> {m.message}</span>
              </>
            )}
          </div>
        ))}
      </div>

      {/* FLOATING GIFTS */}
      {floatGifts.map(g => (
        <div key={g.id} className="lv-ganim pop" style={{left:`${20+Math.random()*60}%`}}>{g.emoji}</div>
      ))}

      {/* TOOLBAR */}
      <div className="lv-toolbar">
        <div className="lv-say-hi">
          <form onSubmit={sendChat}>
            <input id="say-hi-input" placeholder="Say Hi 👋" maxLength={80} value={chatInput}
              onChange={e => setChatInput(e.target.value)} autoComplete="off"/>
          </form>
        </div>
        <div className="lv-tb" onClick={() => setVolOn(v => !v)}>{volOn ? '🔊' : '🔇'}</div>
        <div className={`lv-tb${!mySeat ? ' disabled' : ''}`} onClick={toggleMic}>{muted ? '🔇' : '🎤'}</div>
        <div className="lv-tb" onClick={() => setSheet('leaderboard')}>🏆<div className="lv-tb-dot"></div></div>
        <div className="lv-gift-tb" onClick={() => openGift(null)}>🎁</div>
        <div className="lv-tb" onClick={() => setSheet('settings')}>⋯</div>
      </div>

      {/* OVERLAY */}
      {sheet && <div className="lv-sov" onClick={closeSheet}></div>}

      {/* ── MIC SHEET ── */}
      {sheet === 'mic' && activeSeat && (
        <div className="lv-sheet lv-mic-sh open">
          <div className="lv-sh"></div>
          <div className="lv-ms-title">Mic {activeSeat.seat_number}{activeSeat.is_locked ? ' 🔒' : ''}</div>
          {activeSeat.is_occupied ? (
            activeSeat.user_id === user?.id ? (
              <div className="lv-mo" onClick={leaveMic}>🚪 Leave Mic</div>
            ) : (
              isHostOrAdmin && <>
                <div className="lv-mo" onClick={() => hostMuteSeat(activeSeat, !activeSeat.is_muted)}>
                  {activeSeat.is_muted ? '🔊 Unmute' : '🔇 Mute'}
                </div>
                {isHost && <div className="lv-mo" onClick={() => hostSetAdmin(activeSeat.user_id)}>⭐ Set as Admin</div>}
                <div className="lv-mo danger" onClick={() => { socket.emit('host:kick_seat', { roomId, seatNumber: activeSeat.seat_number }); closeSheet(); }}>🚫 Kick from Mic</div>
              </>
            )
          ) : (
            <>
              {!isHostOrAdmin && <div className="lv-mo" onClick={takeMic}>{activeSeat.is_locked ? '🔒 Locked' : '🎤 Take Mic'}</div>}
              {isHostOrAdmin && <>
                <div className="lv-mo" onClick={takeMic}>🎤 Take this Mic</div>
                <div className="lv-mo" onClick={() => hostInviteToSeat(activeSeat.seat_number)}>📨 Invite User</div>
              </>}
            </>
          )}
          {isHostOrAdmin && (
            <div className="lv-mo" onClick={() => hostLockSeat(activeSeat, !activeSeat.is_locked)}>
              {activeSeat.is_locked ? '🔓 Unlock Mic' : '🔒 Lock Mic'}
            </div>
          )}
          <div className="lv-mo cancel" onClick={closeSheet}>Cancel</div>
        </div>
      )}

      {/* ── GIFT SHEET ── */}
      {sheet === 'gift' && (
        <div className="lv-sheet lv-gift-sh open">
          <div className="lv-sh" style={{background:'rgba(255,255,255,0.08)'}}></div>
          <div className="lv-gs-top">
            <div className="lv-recv">
              <div className="lv-recv-ava">{giftRecipient?.username?.[0] || '👥'}</div>
              <div className="lv-recv-n">To: {giftRecipient?.username || 'Everyone'}</div>
            </div>
            <div className="lv-all-pill" onClick={() => setGiftRecipient(null)}>🎁 All</div>
          </div>
          {/* Recipient picker */}
          <div className="lv-grp-scroll">
            {occupiedSeats.map(s => (
              <div key={s.user_id} className={`lv-grp-item${giftRecipient?.user_id === s.user_id ? ' grp-sel' : ''}`}
                onClick={() => setGiftRecipient(giftRecipient?.user_id === s.user_id ? null : s)}>
                <div className="lv-grp-ava">{s.username?.[0]?.toUpperCase()}</div>
                <div className="lv-grp-uname">{s.username}</div>
                <div className="lv-grp-role">{s.user_id === room?.host_id ? 'Host' : admins.includes(s.user_id) ? 'Admin' : 'Mic'}</div>
                {giftRecipient?.user_id === s.user_id && <div className="lv-grp-check">✓</div>}
              </div>
            ))}
          </div>
          <div className="lv-g-tabs">
            <div className="lv-gt active">All Gifts</div>
          </div>
          <div className="lv-gifts-grid">
            {GIFTS.map(g => (
              <div key={g.emoji} className={`lv-gi${selGift.emoji === g.emoji ? ' sel' : ''}`}
                onClick={() => setSelGift(g)}>
                <div className="lv-gi-e">{g.emoji}</div>
                <div className="lv-gi-n">{g.name}</div>
                <div className="lv-gi-c">🪙{g.cost.toLocaleString()}</div>
              </div>
            ))}
          </div>
          <div className="lv-g-footer">
            <div className="lv-c-show">🪙 {user?.coins?.toLocaleString() || 0}</div>
            <div className="lv-g-send-row">
              <select className="lv-qty-s" value={giftQty} onChange={e => setGiftQty(parseInt(e.target.value))}>
                {[1,5,10,50,99].map(n => <option key={n} value={n}>×{n}</option>)}
              </select>
              <button className="lv-send-b" onClick={sendGift}>Send 🎁</button>
            </div>
          </div>
        </div>
      )}

      {/* ── PROFILE SHEET ── */}
      {sheet === 'profile' && profileUser && (
        <div className="lv-sheet lv-prof-sh open">
          <div className="lv-ps-header-bg">
            <div className="lv-ps-warn" onClick={closeSheet}>✕</div>
          </div>
          <div className="lv-ps-ava-wrap">
            <div className="lv-ps-ava-ring">
              <div className="lv-ps-ava-inner">{profileUser.username?.[0]?.toUpperCase()}</div>
            </div>
          </div>
          <div className="lv-ps-name">{profileUser.username}</div>
          <div className="lv-ps-badges">
            <span className="lv-ps-badge lv-ps-badge-lv">Lv.1</span>
            {profileUser.userId === room?.host_id && <span className="lv-ps-badge lv-ps-badge-host">👑 Host</span>}
          </div>
          <div className="lv-ps-act-row">
            <div className="lv-ps-act-btn">
              <div className="lv-ps-act-icon lv-ps-act-follow">🤍</div>
              <div className="lv-ps-act-label">Follow</div>
            </div>
            <div className="lv-ps-act-btn" onClick={() => openGift({ user_id: profileUser.userId, username: profileUser.username })}>
              <div className="lv-ps-act-icon lv-ps-act-gift">🎁</div>
              <div className="lv-ps-act-label">Gift</div>
            </div>
          </div>
          {isHostOrAdmin && profileUser.userId !== user?.id && (
            <div className="lv-ps-host-row">
              <div className="lv-ps-host-btn" onClick={() => {
                const seat = seats.find(s => s.user_id === profileUser.userId);
                if (seat) hostMuteSeat(seat, !seat.is_muted);
              }}>🔇 Mute</div>
              <div className="lv-ps-host-sep">|</div>
              {isHost && <><div className="lv-ps-host-btn" onClick={() => hostSetAdmin(profileUser.userId)}>⭐ Admin</div>
              <div className="lv-ps-host-sep">|</div></>}
              <div className="lv-ps-host-btn lv-ps-host-danger" onClick={() => {
                const seat = seats.find(s => s.user_id === profileUser.userId);
                if (seat) { socket.emit('host:kick_seat', { roomId, seatNumber: seat.seat_number }); closeSheet(); }
              }}>🚫 Kick</div>
            </div>
          )}
          <div className="lv-mo cancel" onClick={closeSheet}>Close</div>
        </div>
      )}

      {/* ── SETTINGS SHEET ── */}
      {sheet === 'settings' && (
        <div className="lv-sheet lv-settings-sh open">
          <div className="lv-sh"></div>
          <div style={{padding:'0 16px 8px',fontSize:16,fontWeight:800,textAlign:'center'}}>⚙️ Room Settings</div>
          <div className="lv-settings-body">
            <div className="lv-sf-group">
              <div className="lv-sf-label">Room Name</div>
              <input className="lv-sf-input" value={sfName} onChange={e => setSfName(e.target.value)} placeholder="Room name"/>
            </div>
            <div className="lv-sf-group">
              <div className="lv-sf-label">Announcement</div>
              <textarea className="lv-sf-input" rows={3} value={sfAnn} onChange={e => setSfAnn(e.target.value)} placeholder="Welcome message for new joiners..."/>
            </div>
            <div className="lv-sf-group">
              <div className="lv-sf-label">Room Password</div>
              <input className="lv-sf-input" type="password" value={sfPass} onChange={e => setSfPass(e.target.value)} placeholder="Leave blank to remove"/>
            </div>
            {isHost && (
              <div className="lv-sf-group">
                <button className="lv-create-btn-full" style={{background:'rgba(255,255,255,0.08)',marginBottom:0}} onClick={() => setSheet('admins')}>
                  👑 Manage Admins
                </button>
              </div>
            )}
            <button className="lv-create-btn-full" onClick={saveSettings}>Save Settings</button>
          </div>
          <div className="lv-mo cancel" onClick={closeSheet}>Cancel</div>
        </div>
      )}

      {/* ── ADMINS SHEET ── */}
      {sheet === 'admins' && (
        <div className="lv-sheet open" style={{background:'var(--lv-card2)',padding:'0 0 24px',borderRadius:'20px 20px 0 0'}}>
          <div className="lv-sh"></div>
          <div style={{padding:'8px 16px 16px',fontSize:16,fontWeight:800,textAlign:'center'}}>👑 Admins</div>
          <div style={{padding:'0 16px'}}>
            {admins.length === 0 && <p style={{color:'#888',fontSize:13,textAlign:'center',padding:'16px 0'}}>No admins yet. Set one from a seat.</p>}
            {seats.filter(s => s.is_occupied && admins.includes(s.user_id) && s.user_id !== room?.host_id).map(s => (
              <div key={s.user_id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px',background:'rgba(255,255,255,0.04)',borderRadius:12,marginBottom:8}}>
                <span style={{fontSize:14,fontWeight:700}}>⭐ {s.username}</span>
                <button onClick={() => hostRemoveAdmin(s.user_id)} style={{background:'rgba(239,68,68,0.2)',border:'none',borderRadius:8,padding:'6px 14px',color:'#ef4444',fontSize:12,fontWeight:700,cursor:'pointer'}}>Remove</button>
              </div>
            ))}
          </div>
          <div className="lv-mo cancel" onClick={() => setSheet('settings')}>← Back</div>
        </div>
      )}

      {/* ── LEADERBOARD SHEET ── */}
      {sheet === 'leaderboard' && (
        <div className="lv-sheet open" style={{background:'var(--lv-card2)',padding:'0 0 24px',borderRadius:'20px 20px 0 0',maxHeight:'85vh',overflowY:'auto'}}>
          <div className="lv-sh"></div>
          <div style={{textAlign:'center',padding:'16px 0 20px',borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
            <div style={{fontSize:48}}>🏆</div>
            <div style={{fontSize:32,fontWeight:800,color:'#f9c74f'}}>{occupiedSeats.length * 100}</div>
            <div style={{fontSize:12,color:'var(--lv-muted)'}}>Room Trophies</div>
          </div>
          <div style={{padding:'12px 16px'}}>
            {occupiedSeats.map((s, i) => (
              <div key={s.user_id} style={{display:'flex',alignItems:'center',gap:12,background:'rgba(255,255,255,0.04)',borderRadius:14,padding:'12px 14px',marginBottom:8,border:'1px solid rgba(255,255,255,0.06)'}}>
                <div style={{fontSize:22,minWidth:32,textAlign:'center',fontWeight:800,color:'var(--lv-muted)'}}>{['🥇','🥈','🥉'][i] || (i+1)}</div>
                <div style={{fontSize:28}}>{s.username?.[0]?.toUpperCase()}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:14,fontWeight:700}}>{s.username}</div>
                  <div style={{fontSize:11,color:'var(--lv-muted)'}}>Lv.1 · Mic {s.seat_number}</div>
                </div>
                <div style={{fontSize:13,fontWeight:700,color:'#f9c74f'}}>🪙 {(100*(i+1)).toLocaleString()}</div>
              </div>
            ))}
            {occupiedSeats.length === 0 && <p style={{textAlign:'center',color:'var(--lv-muted)',padding:'24px 0',fontSize:13}}>No one on mic yet.</p>}
          </div>
          <div className="lv-mo cancel" onClick={closeSheet}>Close</div>
        </div>
      )}

      {/* ── INVITE SHEET ── */}
      {sheet === 'invite' && (
        <div className="lv-sheet open" style={{background:'var(--lv-card2)',padding:'0 0 24px',borderRadius:'20px 20px 0 0'}}>
          <div className="lv-sh"></div>
          <div style={{padding:'8px 16px 16px',fontSize:16,fontWeight:800,textAlign:'center'}}>
            📨 Invite to Mic {activeSeat?.seat_number}
          </div>
          <div style={{padding:'0 16px',display:'flex',flexDirection:'column',gap:8}}>
            {occupiedSeats.filter(s => s.user_id !== user?.id).map(s => (
              <button key={s.user_id} onClick={() => sendInvite(s.user_id)}
                style={{background:'rgba(167,139,250,0.15)',border:'1.5px solid rgba(167,139,250,0.3)',borderRadius:12,padding:'13px 16px',color:'var(--lv-text)',fontSize:14,fontWeight:700,cursor:'pointer',textAlign:'left'}}>
                {s.username}
              </button>
            ))}
            {occupiedSeats.filter(s => s.user_id !== user?.id).length === 0 &&
              <p style={{color:'var(--lv-muted)',fontSize:13,textAlign:'center',padding:'16px 0'}}>No listeners to invite yet.</p>}
          </div>
          <div className="lv-mo cancel" onClick={closeSheet}>Cancel</div>
        </div>
      )}
    </div>
  );
}
