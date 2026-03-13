import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { getLocalStream, createPeer, removePeer, getPeer } from '../utils/webrtc';

const GIFTS = [
  { emoji:'👏', name:'Applaud',  cost:500   },
  { emoji:'🌹', name:'Rose',     cost:10    },
  { emoji:'💎', name:'Diamond',  cost:99    },
  { emoji:'🎆', name:'Firework', cost:300   },
  { emoji:'🚀', name:'Rocket',   cost:2000  },
  { emoji:'👑', name:'Crown',    cost:999   },
  { emoji:'💕', name:'Love',     cost:50000 },
  { emoji:'📱', name:'GoldPhone',cost:99999 },
  { emoji:'🎵', name:'Music',    cost:600   },
  { emoji:'🍀', name:'Lucky',    cost:400   },
  { emoji:'🎁', name:'Gift',     cost:700   },
  { emoji:'⭐', name:'Star',     cost:1500  },
];

const TOOLS = [
  { emoji:'🏪', name:'Store'     },
  { emoji:'🎒', name:'Bag'       },
  { emoji:'🎁', name:'Gift Box'  },
  { emoji:'⚔️',  name:'PK'       },
  { emoji:'🍀', name:'Lucky Pkt' },
  { emoji:'🏆', name:'Rankings'  },
];

export default function RoomPage() {
  const { id: roomId } = useParams();
  const { user }       = useAuth();
  const socket         = useSocket();
  const navigate       = useNavigate();

  const [room,      setRoom]      = useState(null);
  const [seats,     setSeats]     = useState([]);
  const [messages,  setMessages]  = useState([]);
  const [admins,    setAdmins]    = useState([]);
  const [viewers,      setViewers]      = useState(0);
  const [trophy,       setTrophy]       = useState(0);
  const [userTrophies, setUserTrophies] = useState({}); // { userId: totalCoins }
  const [muted,     setMuted]     = useState(false);
  const [volOn,     setVolOn]     = useState(true);
  const [following, setFollowing] = useState(false);
  const [minimized, setMinimized] = useState(false);

  const [sheet,       setSheet]       = useState(null);
  const [activeSeat,  setActiveSeat]  = useState(null);
  const [profileData, setProfileData] = useState(null);

  const [selGift,    setSelGift]    = useState(GIFTS[0]);
  const [giftQty,    setGiftQty]    = useState(1);
  const [giftRecips, setGiftRecips] = useState([]);

  const [micReq,    setMicReq]    = useState(null);
  const [giftToast, setGiftToast] = useState(null);
  const [giftError, setGiftError] = useState(null);
  const [giftAnim,  setGiftAnim]  = useState(null);

  const [sfName, setSfName] = useState('');
  const [sfAnn,  setSfAnn]  = useState('');
  const [sfPass, setSfPass] = useState('');

  const [showExitModal, setShowExitModal] = useState(false);
  const [chatInput, setChatInput] = useState('');

  const chatRef      = useRef(null);
  const streamRef    = useRef(null);
  const sendingRef   = useRef(false);
  const micReqTimer  = useRef(null);
  const giftToastTmr = useRef(null);
  const giftErrorTmr = useRef(null);
  const bubbleRef    = useRef(null);
  const bubbleDrag   = useRef({ dragging:false, moved:false, startX:0, startY:0, startL:0, startT:0 });

  const isHost        = room?.host_id === user?.id;
  const isAdmin       = admins.includes(user?.id);
  const isHostOrAdmin = isHost || isAdmin;
  const mySeat        = seats.find(s => s.user_id === user?.id);
  const occupiedSeats = seats.filter(s => s.is_occupied);

  /* ── Socket ── */
  useEffect(() => {
    if (!socket || !roomId) return;
    socket.emit('room:join', { roomId });

    socket.on('room:seats', setSeats);
    socket.on('room:viewers', ({ count }) => setViewers(count));
    socket.on('room:info', ({ room: r, admins: a }) => {
      setRoom(r); setAdmins(a||[]); setSfName(r.name||''); setSfAnn(r.announcement||''); setTrophy(r.trophy||0);
    });
    socket.on('room:admins', setAdmins);
    socket.on('room:settings_updated', r => { setRoom(r); setSfName(r.name||''); setSfAnn(r.announcement||''); });
    socket.on('chat:message', msg => {
      setMessages(prev => {
        const next = [...prev.slice(-100), msg];
        setTimeout(() => { chatRef.current && (chatRef.current.scrollTop = chatRef.current.scrollHeight); }, 40);
        return next;
      });
    });
    socket.on('gift:received', ({ from, to, giftType, giftName, qty, totalCost }) => {
      // Use server-authoritative totalCost; fall back to client lookup if missing
      const cost = totalCost ?? (GIFTS.find(g => g.emoji === giftType)?.cost ?? 0) * (qty ?? 1);
      setTrophy(t => t + cost);
      // Track per-user trophy earnings for leaderboard
      if (to) {
        setUserTrophies(prev => ({ ...prev, [to]: (prev[to] || 0) + cost }));
      }
      triggerGiftAnim(giftType || '🎁');
      setGiftToast({ sender: from.username, emoji: giftType || '🎁', name: giftName, qty });
      clearTimeout(giftToastTmr.current);
      giftToastTmr.current = setTimeout(() => setGiftToast(null), 2800);
      // Show success message only to the sender
      if (from.id === user?.id) {
        addSysMsg(`🎁 You sent ${giftType} ${giftName} ×${qty}!`);
      }
    });
    // Sync coin balance after sending a gift
    socket.on('coins:updated', ({ coins }) => {
      // Bubble up to AuthContext if it exposes a setter; otherwise handled locally
      if (typeof user === 'object' && user !== null) user.coins = coins;
    });
    // Show error if gift send fails (e.g. insufficient coins)
    socket.on('gift:error', (msg) => {
      setGiftError(typeof msg === 'string' ? msg : 'Could not send gift');
      clearTimeout(giftErrorTmr.current);
      giftErrorTmr.current = setTimeout(() => setGiftError(null), 3000);
    });
    socket.on('seat:mic_request', ({ userId, username, seatNumber }) => {
      if (!isHost) return;
      setMicReq({ userId, username, seatNumber });
      clearTimeout(micReqTimer.current);
      micReqTimer.current = setTimeout(() => setMicReq(null), 15000);
    });
    // Fix: handle host approval — take the seat automatically
    socket.on('seat:approved', ({ userId: approvedId, seatNumber }) => {
      if (approvedId !== user?.id) return;
      socket.emit('seat:take', { roomId, seatNumber });
      startVoice();
      addSysMsg(`✅ Host approved! You joined Mic ${seatNumber}.`);
    });
    socket.on('seat:invite', ({ userId, seatNumber, fromName }) => {
      if (userId !== user?.id) return;
      if (window.confirm(`${fromName} invited you to Mic ${seatNumber}! Accept?`)) {
        socket.emit('seat:take', { roomId, seatNumber });
        startVoice();
      }
    });
    socket.on('seat:force_mute', ({ seatNumber, muted: m }) => {
      if (mySeat?.seat_number === seatNumber) {
        streamRef.current?.getAudioTracks().forEach(t => { t.enabled = !m; });
        setMuted(m);
      }
    });
    socket.on('room:closed', () => { addSysMsg('🚪 Room ended. Redirecting...'); setTimeout(() => navigate('/'), 2000); });
    socket.on('voice:offer', async ({ from, offer }) => {
      if (!streamRef.current) return;
      const pc = createPeer(from, streamRef.current,
        (tid, stream) => attachAudio(tid, stream),
        (tid, cand)   => socket.emit('voice:ice', { targetId: tid, candidate: cand })
      );
      await pc.setRemoteDescription(offer);
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      socket.emit('voice:answer', { targetId: from, answer: ans });
    });
    socket.on('voice:answer', async ({ from, answer }) => { await getPeer(from)?.setRemoteDescription(answer); });
    socket.on('voice:ice',    async ({ from, candidate }) => { await getPeer(from)?.addIceCandidate(candidate); });
    socket.on('voice:mute',   ({ userId: uid, muted: m }) => setSeats(prev => prev.map(s => s.user_id===uid ? {...s,_muted:m} : s)));

    return () => {
      socket.emit('room:leave', { roomId });
      ['room:seats','room:viewers','room:info','room:admins','room:settings_updated',
       'chat:message','gift:received','gift:error','coins:updated',
       'seat:mic_request','seat:invite','seat:approved','seat:force_mute',
       'room:closed','voice:offer','voice:answer','voice:ice','voice:mute'
      ].forEach(e => socket.off(e));
      streamRef.current?.getTracks().forEach(t => t.stop());
      clearTimeout(micReqTimer.current);
      clearTimeout(giftToastTmr.current);
      clearTimeout(giftErrorTmr.current);
    };
  }, [socket, roomId]);

  const attachAudio = (peerId, stream) => {
    let a = document.getElementById(`audio-${peerId}`);
    if (!a) { a = document.createElement('audio'); a.id=`audio-${peerId}`; a.autoplay=true; document.body.appendChild(a); }
    a.srcObject = stream;
  };
  const startVoice = async () => {
    try { streamRef.current = await getLocalStream(); } catch(e) { console.warn('No mic:', e); }
  };
  const triggerGiftAnim = (emoji) => {
    setGiftAnim(emoji); setTimeout(() => setGiftAnim(null), 1700);
  };
  const addSysMsg = (text) => {
    setMessages(prev => [...prev, { type:'s', message:text, username:'System', _id:Date.now()+Math.random() }]);
    setTimeout(() => { chatRef.current && (chatRef.current.scrollTop = chatRef.current.scrollHeight); }, 40);
  };
  const closeSheet = () => setSheet(null);

  /* ── Seat actions ── */
  const onSeatClick = (seat) => {
    if (seat.is_occupied) {
      if (seat.user_id === user?.id) { setActiveSeat(seat); setSheet('mic_self'); }
      else { setProfileData({ userId:seat.user_id, username:seat.username, seatNumber:seat.seat_number, level:1, fans:0 }); setSheet('profile'); }
    } else {
      setActiveSeat(seat); setSheet('mic_empty');
    }
  };
  const takeMic = () => {
    if (!activeSeat) return;
    if (activeSeat.is_locked && !isHostOrAdmin) { addSysMsg('🔒 This mic is locked.'); closeSheet(); return; }
    socket.emit('seat:take', { roomId, seatNumber: activeSeat.seat_number });
    startVoice(); closeSheet();
  };
  const requestMic = () => {
    socket.emit('seat:request', { roomId, seatNumber: activeSeat.seat_number });
    addSysMsg('🎤 Request sent! Waiting for host approval...'); closeSheet();
  };
  const leaveMic = () => {
    socket.emit('seat:leave', { roomId });
    streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null;
    addSysMsg('🎤 You left the mic.'); closeSheet();
  };
  const approveRequest = () => {
    socket.emit('host:approve_request', { roomId, userId: micReq.userId, seatNumber: micReq.seatNumber });
    setMicReq(null); clearTimeout(micReqTimer.current);
  };
  const hostMuteSeat  = (sn, m)  => { socket.emit('host:mute_seat',   { roomId, seatNumber:sn, muted:m });   closeSheet(); };
  const hostLockSeat  = (sn, lk) => { socket.emit('host:lock_seat',   { roomId, seatNumber:sn, locked:lk }); closeSheet(); };
  const hostKickSeat  = (sn)     => { socket.emit('host:kick_seat',   { roomId, seatNumber:sn });             closeSheet(); };
  const hostSetAdmin  = (uid)    => { socket.emit('host:set_admin',   { roomId, userId:uid });                closeSheet(); };
  const hostRemAdmin  = (uid)    => { socket.emit('host:remove_admin',{ roomId, userId:uid }); };

  /* ── Chat ── */
  const sendChat = (e) => {
    if (e.key !== 'Enter') return;
    if (!chatInput.trim()) return;
    socket.emit('chat:message', { roomId, message: chatInput });
    setChatInput('');
  };

  /* ── Mic toggle ── */
  const toggleMic = () => {
    if (!mySeat) return;
    const next = !muted;
    streamRef.current?.getAudioTracks().forEach(t => { t.enabled = !next; });
    setMuted(next);
    socket.emit('voice:mute', { roomId, muted: next });
  };

  /* ── Gift ── */
  const openGiftSheet = (target) => {
    setGiftRecips(target ? [target] : []);
    setSheet('gift');
  };
  const toggleGiftRecip = (seat) => {
    setGiftRecips(prev => {
      const exists = prev.find(r => r.user_id===seat.user_id);
      if (exists) return prev.length > 1 ? prev.filter(r => r.user_id!==seat.user_id) : prev;
      return [...prev, seat];
    });
  };
  const sendGift = () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    const targets = giftRecips.length > 0 ? giftRecips : occupiedSeats;
    targets.forEach(t => socket.emit('gift:send', { roomId, giftType:selGift.emoji, giftName:selGift.name, qty:giftQty, targetUserId:t.user_id }));
    // Do NOT show success here — wait for server's gift:received (success) or gift:error (fail)
    closeSheet();
    setTimeout(() => { sendingRef.current = false; }, 500);
  };

  /* ── Settings ── */
  const saveSettings = () => {
    socket.emit('room:update_settings', { roomId, name:sfName, announcement:sfAnn, password:sfPass||undefined });
    addSysMsg('⚙️ Settings saved!'); closeSheet();
  };

  /* ── Exit ── */
  const handleExit = () => isHost ? setShowExitModal(true) : navigate('/');
  const doEndRoom  = () => { socket.emit('room:end', { roomId }); navigate('/'); };
  const doMinimize = () => { setShowExitModal(false); setMinimized(true); };

  /* ── Bubble drag ── */
  const onBubbleTouchStart = (e) => {
    const t = e.touches[0], rect = bubbleRef.current.getBoundingClientRect();
    bubbleDrag.current = { dragging:true, moved:false, startX:t.clientX, startY:t.clientY, startL:rect.left, startT:rect.top };
  };
  const onBubbleTouchMove = (e) => {
    const d = bubbleDrag.current; if (!d.dragging) return;
    const t = e.touches[0], dx = t.clientX-d.startX, dy = t.clientY-d.startY;
    if (Math.abs(dx)>4||Math.abs(dy)>4) d.moved = true;
    if (!d.moved) return;
    const W = window.innerWidth, H = window.innerHeight;
    bubbleRef.current.style.left  = Math.max(0, Math.min(d.startL+dx, W-70))+'px';
    bubbleRef.current.style.top   = Math.max(0, Math.min(d.startT+dy, H-70))+'px';
    bubbleRef.current.style.right = 'auto'; bubbleRef.current.style.bottom = 'auto';
  };
  const onBubbleTouchEnd = () => {
    const d = bubbleDrag.current; d.dragging = false;
    if (!d.moved) { setMinimized(false); return; }
    const W = window.innerWidth, cx = parseFloat(bubbleRef.current.style.left)+35;
    bubbleRef.current.style.left = (cx < W/2) ? '16px' : (W-78)+'px';
  };

  /* ── MINIMIZE BUBBLE ── */
  if (minimized) return (
    <div ref={bubbleRef} id="lv-bubble"
      onTouchStart={onBubbleTouchStart} onTouchMove={onBubbleTouchMove} onTouchEnd={onBubbleTouchEnd}>
      <div className="lv-mb-inner">
        <span className="lv-mb-emoji">{room?.name?.[0]||'🌙'}</span>
        <div className="lv-mb-live-dot"></div>
        <div className="lv-mb-close" onClick={e => { e.stopPropagation(); navigate('/'); }}>✕</div>
      </div>
      <div className="lv-mb-tooltip">{room?.name||'Room'}</div>
    </div>
  );

  return (
    <div className="lv-page">

      {/* BACKGROUND */}
      <div className="lv-bg">
        <div className="lv-bg-grad"></div>
        <div className="lv-stars"></div>
        <div className="lv-orb o1"></div><div className="lv-orb o2"></div><div className="lv-orb o3"></div>
        <div className="lv-ground"></div>
        <div className="lv-silhouette">
          <svg viewBox="0 0 480 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0,80 L0,55 L20,55 L20,40 L30,40 L30,30 L40,30 L40,40 L50,40 L50,20 L55,15 L60,20 L60,40 L70,40 L70,55 L90,55 L90,45 L100,45 L100,35 L108,35 L108,45 L120,45 L120,55 L140,55 L140,42 L148,38 L155,42 L155,55 L170,55 L170,30 L178,22 L186,30 L186,55 L200,55 L200,48 L210,48 L210,38 L218,32 L226,38 L226,48 L240,48 L240,55 L260,55 L260,40 L268,33 L276,40 L276,55 L300,55 L300,45 L310,40 L320,45 L320,55 L340,55 L340,48 L350,42 L360,48 L360,55 L380,55 L380,35 L388,28 L396,35 L396,55 L420,55 L420,48 L430,44 L440,48 L440,55 L460,55 L460,50 L470,46 L480,50 L480,80 Z" fill="#080812" opacity="0.9"/>
            <path d="M0,80 L0,65 L60,65 L60,60 L120,60 L120,65 L180,65 L180,60 L240,60 L240,65 L300,65 L300,60 L360,60 L360,65 L420,65 L420,60 L480,60 L480,80 Z" fill="#06060f" opacity="0.8"/>
          </svg>
        </div>
      </div>

      {/* MIC REQUEST TOAST */}
      {micReq && (
        <div className="lv-req-toast">
          <div className="lv-req-inner">
            <div className="lv-req-ava">🎤</div>
            <div className="lv-req-info">
              <div className="lv-req-name">{micReq.username}</div>
              <div className="lv-req-sub">wants Mic {micReq.seatNumber}</div>
            </div>
            <div className="lv-req-btns">
              <button className="lv-req-btn approve" onClick={approveRequest}>✓ Allow</button>
              <button className="lv-req-btn decline" onClick={() => setMicReq(null)}>✕</button>
            </div>
          </div>
        </div>
      )}

      {/* GIFT BROADCAST TOAST */}
      {giftToast && (
        <div className="lv-gift-broadcast">
          {giftToast.emoji} <b>{giftToast.sender}</b> sent {giftToast.name} ×{giftToast.qty}
        </div>
      )}

      {/* GIFT ERROR TOAST */}
      {giftError && (
        <div className="lv-gift-error">
          ❌ {giftError}
        </div>
      )}

      {/* TOP BAR */}
      <div className="lv-topbar">
        <div className="lv-tl">
          <div className="lv-room-ava">
            {room?.cover_url ? <img src={room.cover_url} alt=""/> : (room?.name?.[0]||'🌙')}
          </div>
          <div>
            <div className="lv-room-title">{room?.name||'Loading...'}</div>
            <div className="lv-room-id">ID:{roomId}</div>
          </div>
        </div>
        <div className="lv-coins-pill">🏆 {trophy.toLocaleString()}</div>
        <div className="lv-tr">
          <div className="lv-vpill">👥 <span>{viewers||occupiedSeats.length}</span></div>
          {!isHost && (
            <div className={`lv-tbtn lv-follow-btn${following?' following':''}`} onClick={() => setFollowing(f=>!f)}>
              {following?'🩷':'🤍'}
            </div>
          )}
          <div className="lv-tbtn" onClick={handleExit}>⏻</div>
        </div>
      </div>

      {/* MIC SLOTS */}
      <div className="lv-mics-wrap">
        <div className="lv-mics-grid">
          {seats.map(seat => {
            const isOcc    = seat.is_occupied;
            const isMe     = seat.user_id === user?.id;
            const isHostSt = seat.user_id === room?.host_id;
            const isAdmSt  = admins.includes(seat.user_id) && !isHostSt;
            return (
              <div key={seat.seat_number}
                className={`lv-mic-slot${isOcc?' occupied':''}${seat.is_locked?' locked':''}`}
                onClick={() => onSeatClick(seat)}>
                <div className={`lv-mic-ring${isOcc?' ring-occ':''}${isMe?' speaking':''}${isAdmSt?' admin-ring':''}`}>
                  {isOcc ? (
                    <div className="lv-ava-fill" style={{background: isHostSt
                      ?'linear-gradient(135deg,#a78bfa,#f472b6)'
                      :'linear-gradient(135deg,#34d399,#0891b2)'}}>
                      {seat.avatar_url ? <img src={seat.avatar_url} alt=""/> : (seat.username?.[0]?.toUpperCase()||'?')}
                    </div>
                  ) : seat.is_locked ? <span className="lv-mic-ico">🔒</span>
                    : <span className="lv-mic-ico">🎤</span>
                  }
                  {isHostSt && <div className="lv-host-tag">👑 Host</div>}
                  {isAdmSt  && <div className="lv-admin-tag">⚡Admin</div>}
                </div>
                <div className="lv-mic-label">
                  {isOcc ? seat.username : (seat.is_locked ? 'Locked' : `No.${seat.seat_number}`)}
                </div>
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
        <div className="lv-msg lv-sys">
          <span className="lv-sys-txt">🌿 Welcome to {room?.name||'the room'}! Please be respectful.</span>
        </div>
        {messages.map((m, i) => {
          if (m.type==='s') return (
            <div key={m._id||i} className="lv-msg lv-sys">
              <span className="lv-sys-txt">{m.message}</span>
            </div>
          );
          const isHostMsg  = m.userId === room?.host_id;
          const isAdminMsg = admins.includes(m.userId);
          return (
            <div key={m._id||i} className="lv-msg">
              <div className={`lv-msg-ava${isHostMsg?' host-ava':isAdminMsg?' admin-ava':''}`}>
                {m.username?.[0]?.toUpperCase()||'?'}
              </div>
              {isAdminMsg && !isHostMsg && <span className="lv-msg-admin-tag">Admin</span>}
              <span className={`lv-msg-name${isHostMsg?' h':isAdminMsg?' a':' n'}`}>{m.username}</span>
              <span className="lv-msg-txt"> {m.message}</span>
            </div>
          );
        })}
      </div>

      {/* GIFT ANIMATION */}
      {giftAnim && <div className="lv-ganim pop">{giftAnim}</div>}

      {/* TOOLBAR */}
      <div className="lv-toolbar">
        <div className="lv-say-hi">
          <input placeholder="Say Hi 👋" maxLength={80} value={chatInput}
            onChange={e => setChatInput(e.target.value)} onKeyDown={sendChat} autoComplete="off"/>
        </div>
        <div className="lv-tb" onClick={() => setVolOn(v=>!v)}>{volOn?'🔊':'🔇'}</div>
        <div className={`lv-tb${!mySeat?' lv-tb-off':''}`} onClick={toggleMic}>{muted?'🔇':'🎤'}</div>
        <div className="lv-tb" onClick={() => setSheet('leaderboard')}>🏆<div className="lv-tb-dot"></div></div>
        <div className="lv-gift-tb" onClick={() => openGiftSheet(null)}>🎁</div>
        <div className="lv-tb" onClick={() => setSheet('tools')}>⋯</div>
      </div>

      {/* OVERLAY */}
      {sheet && <div className="lv-sov" onClick={closeSheet}></div>}

      {/* ── MIC SHEET: empty ── */}
      {sheet==='mic_empty' && activeSeat && (
        <div className="lv-sheet lv-mic-sh open">
          <div className="lv-sh"></div>
          <div className="lv-ms-title">Mic {activeSeat.seat_number}{activeSeat.is_locked?' 🔒':''}</div>
          {isHostOrAdmin ? (<>
            <div className="lv-mo" onClick={takeMic}>🎤 Take this Mic</div>
            <div className="lv-mo" onClick={() => setSheet('invite')}>📨 Invite User</div>
            <div className="lv-mo" onClick={() => hostLockSeat(activeSeat.seat_number, !activeSeat.is_locked)}>
              {activeSeat.is_locked?'🔓 Unlock Mic':'🔒 Lock Mic'}
            </div>
          </>) : activeSeat.is_locked ? (
            <div className="lv-mo" style={{opacity:0.5}}>🔒 Mic is locked</div>
          ) : (<>
            <div className="lv-mo" onClick={takeMic}>🎤 Take Mic</div>
            <div className="lv-mo" onClick={requestMic}>✋ Request Mic</div>
          </>)}
          <div className="lv-mo cancel" onClick={closeSheet}>Cancel</div>
        </div>
      )}

      {/* ── MIC SHEET: self ── */}
      {sheet==='mic_self' && (
        <div className="lv-sheet lv-mic-sh open">
          <div className="lv-sh"></div>
          <div className="lv-ms-title">You are on Mic {mySeat?.seat_number}</div>
          <div className="lv-mo" onClick={() => { toggleMic(); closeSheet(); }}>
            {muted?'🔊 Unmute Mic':'🔇 Mute Mic'}
          </div>
          <div className="lv-mo danger" onClick={leaveMic}>🚪 Leave Mic</div>
          <div className="lv-mo cancel" onClick={closeSheet}>Cancel</div>
        </div>
      )}

      {/* ── PROFILE SHEET ── */}
      {sheet==='profile' && profileData && (
        <div className="lv-sheet lv-prof-sh open">
          <div className="lv-ps-header-bg">
            <div className="lv-ps-close" onClick={closeSheet}>✕</div>
          </div>
          <div className="lv-ps-ava-wrap">
            <div className="lv-ps-ava-ring">
              <div className="lv-ps-ava-inner">{profileData.username?.[0]?.toUpperCase()||'?'}</div>
            </div>
          </div>
          <div className="lv-ps-name">{profileData.username}</div>
          <div className="lv-ps-badges">
            <span className="lv-ps-badge lv-ps-badge-lv">Lv.{profileData.level||1}</span>
            {profileData.userId===room?.host_id && <span className="lv-ps-badge lv-ps-badge-host">👑 Host</span>}
            {admins.includes(profileData.userId) && profileData.userId!==room?.host_id &&
              <span className="lv-ps-badge" style={{background:'linear-gradient(90deg,#34d399,#0891b2)'}}>⚡ Admin</span>}
          </div>
          <div className="lv-ps-meta">❤️ {(profileData.fans||0).toLocaleString()} Fans</div>
          <div className="lv-ps-act-row">
            <div className="lv-ps-act-btn"><div className="lv-ps-act-icon lv-ps-act-follow">🤍</div><div className="lv-ps-act-label">Follow</div></div>
            <div className="lv-ps-act-btn"><div className="lv-ps-act-icon lv-ps-act-chat">💬</div><div className="lv-ps-act-label">Chat</div></div>
            <div className="lv-ps-act-btn"><div className="lv-ps-act-icon lv-ps-act-at">@</div><div className="lv-ps-act-label">Mention</div></div>
            <div className="lv-ps-act-btn" onClick={() => openGiftSheet(seats.find(s=>s.user_id===profileData.userId))}>
              <div className="lv-ps-act-icon lv-ps-act-gift">🎁</div><div className="lv-ps-act-label">Gift</div>
            </div>
          </div>
          {isHostOrAdmin && profileData.userId!==user?.id && (
            <div className="lv-ps-host-row">
              <div className="lv-ps-host-btn" onClick={() => { const s=seats.find(x=>x.user_id===profileData.userId); s&&hostMuteSeat(s.seat_number,!s.is_muted); }}>🔇 Mute</div>
              <div className="lv-ps-host-sep">|</div>
              <div className="lv-ps-host-btn" onClick={() => { const s=seats.find(x=>x.user_id===profileData.userId); s&&hostLockSeat(s.seat_number,true); }}>🔒 Lock</div>
              <div className="lv-ps-host-sep">|</div>
              {isHost && <><div className="lv-ps-host-btn" onClick={() => hostSetAdmin(profileData.userId)}>⭐ Admin</div><div className="lv-ps-host-sep">|</div></>}
              <div className="lv-ps-host-btn lv-ps-host-danger" onClick={() => { const s=seats.find(x=>x.user_id===profileData.userId); s&&hostKickSeat(s.seat_number); }}>🚫 Kick</div>
            </div>
          )}
          <div className="lv-mo cancel" style={{color:'#555',background:'#f5f5f5',margin:'8px 16px',borderRadius:14}} onClick={closeSheet}>Close</div>
        </div>
      )}

      {/* ── GIFT SHEET ── */}
      {sheet==='gift' && (
        <div className="lv-sheet lv-gift-sh open">
          <div className="lv-sh" style={{background:'rgba(255,255,255,0.08)'}}></div>
          <div className="lv-gs-top">
            <div className="lv-recv">
              <div className="lv-recv-ava">{giftRecips.length===1?(giftRecips[0].username?.[0]?.toUpperCase()||'?'):'👥'}</div>
              <div className="lv-recv-n">To: {giftRecips.length===0?'Everyone':giftRecips.length===1?giftRecips[0].username:`${giftRecips.length} people`}</div>
            </div>
            <div className="lv-all-pill" onClick={() => setGiftRecips(occupiedSeats)}>🎯 All</div>
          </div>
          {/* Recipient picker */}
          <div className="lv-grp-wrap">
            <div className="lv-grp-label">SELECT RECIPIENT</div>
            <div className="lv-grp-scroll">
              {occupiedSeats.map(s => {
                const sel = giftRecips.find(r=>r.user_id===s.user_id);
                return (
                  <div key={s.user_id} className={`lv-grp-item${sel?' grp-sel':''}`} onClick={() => toggleGiftRecip(s)}>
                    <div className="lv-grp-ava">{s.username?.[0]?.toUpperCase()||'?'}</div>
                    <div className="lv-grp-uname">{s.username}</div>
                    <div className="lv-grp-role">{s.user_id===room?.host_id?'Host':admins.includes(s.user_id)?'Admin':'Mic'}</div>
                    <div className="lv-grp-check">{sel?'✓':''}</div>
                  </div>
                );
              })}
              {occupiedSeats.length===0 && <div style={{color:'var(--lv-muted)',fontSize:12,padding:'8px 4px'}}>No one on mic</div>}
            </div>
          </div>
          <div className="lv-g-tabs">
            <div className="lv-gt active">Gift</div>
            <div className="lv-gt">Activity</div>
            <div className="lv-gt">Custom</div>
            <div className="lv-gt">Exclusive</div>
          </div>
          <div className="lv-gifts-grid">
            {GIFTS.map(g => (
              <div key={g.emoji} className={`lv-gi${selGift.emoji===g.emoji?' sel':''}`} onClick={() => setSelGift(g)}>
                <div className="lv-gi-e">{g.emoji}</div>
                <div className="lv-gi-n">{g.name}</div>
                <div className="lv-gi-c">🪙{g.cost.toLocaleString()}</div>
              </div>
            ))}
          </div>
          <div className="lv-g-footer">
            <div>
              <div className="lv-c-show">🪙 {(user?.coins||0).toLocaleString()}</div>
              <div style={{fontSize:10,color:'var(--lv-muted)',marginTop:2}}>Total: 🪙{(selGift.cost*giftQty*Math.max(1,giftRecips.length)).toLocaleString()}</div>
            </div>
            <div className="lv-g-send-row">
              <select className="lv-qty-s" value={giftQty} onChange={e=>setGiftQty(+e.target.value)}>
                {[1,5,10,50,99].map(n=><option key={n} value={n}>×{n}</option>)}
              </select>
              <button className="lv-send-b" onClick={sendGift}>Send</button>
            </div>
          </div>
        </div>
      )}

      {/* ── SETTINGS SHEET ── */}
      {sheet==='settings' && (
        <div className="lv-sheet lv-settings-sh open">
          <div className="lv-sh"></div>
          <div className="lv-sh-title">⚙️ Room Settings</div>
          <div className="lv-settings-body">
            <div className="lv-sf-group">
              <div className="lv-sf-label">Room Name</div>
              <input className="lv-sf-input" value={sfName} onChange={e=>setSfName(e.target.value)} placeholder="Room name"/>
            </div>
            <div className="lv-sf-group">
              <div className="lv-sf-label">Announcement</div>
              <textarea className="lv-sf-input" rows={3} value={sfAnn} onChange={e=>setSfAnn(e.target.value)} placeholder="Welcome message..."/>
            </div>
            <div className="lv-sf-group">
              <div className="lv-sf-label">Password</div>
              <input className="lv-sf-input" type="password" value={sfPass} onChange={e=>setSfPass(e.target.value)} placeholder="Leave blank to remove"/>
            </div>
            {isHost && <button className="lv-sf-btn-outline" onClick={() => setSheet('admins')}>👑 Manage Admins</button>}
            <button className="lv-create-btn-full" onClick={saveSettings}>Save Settings</button>
          </div>
          <div className="lv-mo cancel" onClick={closeSheet}>Cancel</div>
        </div>
      )}

      {/* ── ADMINS SHEET ── */}
      {sheet==='admins' && (
        <div className="lv-sheet lv-list-sh open">
          <div className="lv-sh"></div>
          <div className="lv-sh-title">👑 Admins</div>
          <div className="lv-list-body">
            {seats.filter(s=>s.is_occupied&&admins.includes(s.user_id)&&s.user_id!==room?.host_id).map(s=>(
              <div key={s.user_id} className="lv-list-row">
                <div className="lv-list-ava">{s.username?.[0]?.toUpperCase()}</div>
                <div className="lv-list-name">⭐ {s.username}</div>
                <button className="lv-list-danger-btn" onClick={() => hostRemAdmin(s.user_id)}>Remove</button>
              </div>
            ))}
            {seats.filter(s=>s.is_occupied&&admins.includes(s.user_id)&&s.user_id!==room?.host_id).length===0 && (
              <div className="lv-list-empty">No admins yet.</div>
            )}
          </div>
          <div className="lv-mo cancel" onClick={() => setSheet('settings')}>← Back</div>
        </div>
      )}

      {/* ── LEADERBOARD SHEET ── */}
      {sheet==='leaderboard' && (
        <div className="lv-sheet lv-lb-sh open">
          <div className="lv-sh"></div>
          <div className="lv-lb-top">
            <div className="lv-lb-icon">🏆</div>
            <div className="lv-lb-total">{trophy.toLocaleString()}</div>
            <div className="lv-lb-label">Room Trophies</div>
          </div>
          <div className="lv-lb-list">
            {occupiedSeats.length===0 && <div className="lv-list-empty">No gifts yet 🎁</div>}
            {[...occupiedSeats]
              .sort((a, b) => (userTrophies[b.user_id] || 0) - (userTrophies[a.user_id] || 0))
              .map((s, i) => (
              <div key={s.user_id} className={`lv-lb-card${i===0?' lv-lb-top1':i===1?' lv-lb-top2':i===2?' lv-lb-top3':''}`}>
                <div className="lv-lb-rank">{['🥇','🥈','🥉'][i]||`#${i+1}`}</div>
                <div className="lv-lb-ava">{s.username?.[0]?.toUpperCase()}</div>
                <div className="lv-lb-info">
                  <div className="lv-lb-uname">{s.username}</div>
                  <div className="lv-lb-sub">Lv.1 · Mic {s.seat_number}</div>
                </div>
                <div className="lv-lb-coins">🏆 {(userTrophies[s.user_id] || 0).toLocaleString()}</div>
              </div>
            ))}
          </div>
          <div className="lv-mo cancel" onClick={closeSheet}>Close</div>
        </div>
      )}

      {/* ── INVITE SHEET ── */}
      {sheet==='invite' && (
        <div className="lv-sheet lv-list-sh open">
          <div className="lv-sh"></div>
          <div className="lv-sh-title">📨 Invite to Mic {activeSeat?.seat_number}</div>
          <div className="lv-list-body">
            {occupiedSeats.filter(s=>s.user_id!==user?.id).map(s=>(
              <div key={s.user_id} className="lv-list-row">
                <div className="lv-list-ava">{s.username?.[0]?.toUpperCase()}</div>
                <div className="lv-list-name">{s.username}</div>
                <button className="lv-list-invite-btn" onClick={() => {
                  socket.emit('host:invite', { roomId, userId:s.user_id, seatNumber:activeSeat?.seat_number });
                  addSysMsg(`📨 Invite sent to ${s.username}!`); closeSheet();
                }}>Invite</button>
              </div>
            ))}
            {occupiedSeats.filter(s=>s.user_id!==user?.id).length===0 && (
              <div className="lv-list-empty">No listeners to invite yet.</div>
            )}
          </div>
          <div className="lv-mo cancel" onClick={closeSheet}>Cancel</div>
        </div>
      )}

      {/* ── MORE TOOLS SHEET ── */}
      {sheet==='tools' && (
        <div className="lv-sheet lv-tools-sh open">
          <div className="lv-sh"></div>
          <div className="lv-sh-title">More</div>
          <div className="lv-tools-grid">
            {TOOLS.map(t=>(
              <div key={t.name} className="lv-tool-item" onClick={() => { addSysMsg(`${t.emoji} ${t.name} — coming soon!`); closeSheet(); }}>
                <div className="lv-tool-icon">{t.emoji}</div>
                <div className="lv-tool-name">{t.name}</div>
              </div>
            ))}
          </div>
          {isHost && (
            <div style={{padding:'0 16px 8px'}}>
              <button className="lv-sf-btn-outline" style={{width:'100%'}} onClick={() => setSheet('settings')}>⚙️ Room Settings</button>
            </div>
          )}
          <div className="lv-mo cancel" onClick={closeSheet}>Close</div>
        </div>
      )}

      {/* ── HOST EXIT MODAL ── */}
      {showExitModal && (
        <>
          <div className="lv-hem-overlay" onClick={() => setShowExitModal(false)}></div>
          <div className="lv-hem-modal">
            <div className="lv-hem-icon">🚪</div>
            <div className="lv-hem-title">Leave the room?</div>
            <div className="lv-hem-sub">Choose what happens to your room</div>
            <div className="lv-hem-options">
              <button className="lv-hem-btn lv-hem-offline" onClick={doEndRoom}>
                <div className="lv-hem-btn-icon">⏻</div>
                <div className="lv-hem-btn-text">
                  <div className="lv-hem-btn-label">End Room</div>
                  <div className="lv-hem-btn-desc">Close the room for everyone</div>
                </div>
              </button>
              <button className="lv-hem-btn lv-hem-stay" onClick={doMinimize}>
                <div className="lv-hem-btn-icon">🫧</div>
                <div className="lv-hem-btn-text">
                  <div className="lv-hem-btn-label">Minimize</div>
                  <div className="lv-hem-btn-desc">Room stays live, browse freely</div>
                </div>
              </button>
            </div>
            <button className="lv-hem-cancel" onClick={() => setShowExitModal(false)}>Stay in Room</button>
          </div>
        </>
      )}

    </div>
  );
}
