import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';

// ── Constants ──────────────────────────────────────────────────────
const ROOM_COLORS = ['c1','c2','c3','c4','c5','c6'];
const COVER_EMOJIS = ['🌙','🔥','🎵','💜','🌸','✨','🎭','🌿'];
const TAGS = { Singing:'#f97316','Making Friends':'#a855f7',Chatting:'#0ea5e9',Gaming:'#22c55e' };

const MAX_RECENT = 6;
const RECENT_KEY = 'heylla_recent_rooms';

function saveRecentRoom(room){
  try{
    let list = JSON.parse(localStorage.getItem(RECENT_KEY)||'[]');
    list = list.filter(r=>r.id!==room.id);
    list.unshift(room);
    if(list.length>MAX_RECENT) list=list.slice(0,MAX_RECENT);
    localStorage.setItem(RECENT_KEY,JSON.stringify(list));
  }catch(e){}
}
function getRecentRooms(){
  try{ return JSON.parse(localStorage.getItem(RECENT_KEY)||'[]'); }catch(e){ return []; }
}

// ── RoomCard ───────────────────────────────────────────────────────
function RoomCard({ room, index, onClick }){
  const colorClass = ROOM_COLORS[index % ROOM_COLORS.length];
  return (
    <div className="hp-room-card" onClick={onClick}>
      <div className={`hp-room-cover ${colorClass}`}>
        <span className="hp-cover-emoji">{room.emoji || room.name?.[0] || '🎙'}</span>
        <div className="hp-live-badge"><div className="hp-live-dot"></div><span>{room.listener_count||0}</span></div>
        <div className="hp-mic-count">🎙 8</div>
      </div>
      <div className="hp-room-info">
        <div className="hp-room-name-card">{room.name}</div>
        <div className="hp-room-owner">
          <div className="hp-owner-ava">
            {room.host_avatar
              ? <img src={room.host_avatar} alt="" loading="lazy"/>
              : (room.host_username?.[0]?.toUpperCase()||'?')}
          </div>
          <span className="hp-owner-name">{room.host_username||room.tag||'Room'}</span>
        </div>
      </div>
    </div>
  );
}

// ── CreateRoomModal ────────────────────────────────────────────────
function CreateRoomModal({ open, onClose, onCreated, hasExistingRoom }){
  const [name,          setName]          = useState('');
  const [selectedEmoji, setSelectedEmoji] = useState('🌙');
  const [tag,           setTag]           = useState('Chatting');
  const [loading,       setLoading]       = useState(false);
  const [nameErr,       setNameErr]       = useState(false);

  const handleCreate = async () => {
    if(!name.trim()){ setNameErr(true); return; }
    setLoading(true);
    try{
      const { data } = await api.post('/rooms', { name: name.trim(), tag, description: '' });
      const roomId = data.id || data.room?.id || data;
      onCreated(roomId);
    }catch(e){
      alert(e.response?.data?.error||'Failed to create room');
    }finally{ setLoading(false); }
  };

  const handleReset = () => { setName(''); setSelectedEmoji('🌙'); setTag('Chatting'); setNameErr(false); };

  if(!open) return null;
  return (
    <div className="hp-modal-overlay" onClick={e=>{ if(e.target.classList.contains('hp-modal-overlay')){ handleReset(); onClose(); }}}>
      <div className="hp-modal-sheet">
        <div className="hp-modal-handle"></div>
        <div className="hp-modal-title">Create a Room</div>
        {hasExistingRoom && (
          <div style={{margin:'0 16px 8px',padding:'10px 12px',background:'rgba(249,115,22,0.15)',borderRadius:'10px',fontSize:'12px',color:'#f97316',lineHeight:'1.5'}}>
            ⚠️ You already have an active room. Creating a new one will <strong>replace</strong> your existing room.
          </div>
        )}
        <div className="hp-modal-body">
          <div>
            <div className="hp-form-label">ROOM NAME</div>
            <input
              className="hp-form-input"
              placeholder="e.g. Chill Vibes Only..."
              maxLength={40}
              value={name}
              style={nameErr?{borderColor:'var(--lv-accent2)'}:{}}
              onChange={e=>{ setName(e.target.value); setNameErr(false); }}
              autoFocus
            />
          </div>
          <div>
            <div className="hp-form-label">CATEGORY</div>
            <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
              {Object.keys(TAGS).map(t=>(
                <div key={t} onClick={()=>setTag(t)} className={`hp-tag-pill${tag===t?' sel':''}`}
                  style={{ '--tag-color': TAGS[t] }}>{t}</div>
              ))}
            </div>
          </div>
          <div>
            <div className="hp-form-label">EMOJI COVER</div>
            <div className="hp-emoji-picker">
              {COVER_EMOJIS.map(e=>(
                <div key={e} className={`hp-emoji-opt${selectedEmoji===e?' selected':''}`} onClick={()=>setSelectedEmoji(e)}>{e}</div>
              ))}
            </div>
          </div>
        </div>
        <div className="hp-modal-footer">
          <button className="hp-create-room-btn" onClick={handleCreate} disabled={loading}>
            {loading?'Creating...':'Create Room'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── HomePage ───────────────────────────────────────────────────────
export default function HomePage(){
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [mainTab,     setMainTab]     = useState('popular');
  const [subTab,      setSubTab]      = useState('following');
  const [rooms,       setRooms]       = useState([]);
  const [roomsStatus, setRoomsStatus] = useState('loading');
  const [following,   setFollowing]   = useState([]);
  const [followStatus,setFollowStatus]= useState('idle');
  const [recentRooms, setRecentRooms] = useState([]);
  const [showCreate,  setShowCreate]  = useState(false);
  const [myRoom,      setMyRoom]      = useState(null);
  const [myRoomLoading, setMyRoomLoading] = useState(false);

  const pollTimer    = useRef(null);
  const fetchPending = useRef(false);

  // ── Load my room ─────────────────────────────────────────────
  const loadMyRoom = useCallback(async () => {
    setMyRoomLoading(true);
    try {
      const { data } = await api.get('/rooms/mine');
      console.log('[loadMyRoom] response:', data);
      setMyRoom(data || null);
    } catch (e) {
      console.log('[loadMyRoom] error (treating as no room):', e?.response?.status, e?.message);
      setMyRoom(null);
    }
    setMyRoomLoading(false); // outside finally to ensure it always runs
  }, []);

  // ── Load live rooms ──────────────────────────────────────────
  const loadRooms = useCallback(async (initial=false)=>{
    if(fetchPending.current && !initial) return;
    fetchPending.current = true;
    if(initial) setRoomsStatus('loading');
    try{
      const { data } = await api.get('/rooms');
      const list = Array.isArray(data) ? data : (data.rooms||[]);
      setRooms(list);
      setRoomsStatus(list.length ? 'ok' : 'empty');
    }catch(e){
      if(initial) setRoomsStatus('error');
    }finally{ fetchPending.current = false; }
  },[]);

  // ── Load following ───────────────────────────────────────────
  const loadFollowing = useCallback(async ()=>{
    setFollowStatus('loading');
    try{
      // Falls back to all rooms until a /following endpoint is added
      const { data } = await api.get('/rooms');
      const list = Array.isArray(data) ? data : (data.rooms||[]);
      setFollowing(list);
      setFollowStatus(list.length ? 'ok' : 'empty');
    }catch(e){ setFollowStatus('error'); }
  },[]);

  // ── Polling ──────────────────────────────────────────────────
  useEffect(()=>{
    loadRooms(true);
    loadMyRoom(); // load on mount so Me tab is ready instantly
    pollTimer.current = setInterval(()=>{
      if(document.visibilityState==='visible') loadRooms(false);
    }, 5000);
    const onVis = ()=>{ if(document.visibilityState==='visible') loadRooms(false); };
    document.addEventListener('visibilitychange', onVis);
    return ()=>{ clearInterval(pollTimer.current); document.removeEventListener('visibilitychange', onVis); };
  },[loadRooms]);

  // ── Me tab effects ───────────────────────────────────────────
  useEffect(()=>{
    if(mainTab==='me'){
      loadMyRoom();
      if(subTab==='following' && followStatus==='idle') loadFollowing();
      if(subTab==='recent') setRecentRooms(getRecentRooms());
    }
  },[mainTab, subTab]);

  const handleSubTab = (tab)=>{
    setSubTab(tab);
    if(tab==='following') loadFollowing();
    if(tab==='recent') setRecentRooms(getRecentRooms());
  };

  const goToRoom = (room)=>{
    saveRecentRoom({ id:room.id, name:room.name, emoji:room.emoji||room.name?.[0], owner:room.host_username||'?' });
    navigate(`/room/${room.id}`);
  };

  const handleRoomCreated = (roomId)=>{
    setShowCreate(false);
    loadMyRoom();
    navigate(`/room/${roomId}`);
  };

  // ── + button handler ─────────────────────────────────────────
  const handlePlusBtn = ()=>{
    if(myRoom) navigate(`/room/${myRoom.id}`);
    else setShowCreate(true);
  };

  return (
    <div className="hp-root">

      {/* ── TOP NAV ── */}
      <div className="hp-top-nav">
        <div className="hp-nav-tabs">
          <div className={`hp-nav-tab${mainTab==='me'?' active':''}`}    onClick={()=>setMainTab('me')}>Me</div>
          <div className={`hp-nav-tab${mainTab==='popular'?' active':''}`} onClick={()=>setMainTab('popular')}>Popular</div>
        </div>
        <div className="hp-nav-right">
          <div className="hp-icon-btn">🔍</div>
          <div className="hp-create-btn" onClick={handlePlusBtn}>＋</div>
        </div>
      </div>

      {/* ══════════════ POPULAR ══════════════ */}
      <div className={`hp-page${mainTab==='popular'?' active':''}`}>

        <div className="hp-banner">
          <span className="hp-banner-decor left">🎖️</span>
          <span className="hp-banner-decor right">🎖️</span>
          <div className="hp-banner-content">
            <div className="hp-banner-title">Welcome to Heylla 🎙</div>
            <div className="hp-banner-sub">Find a room and join the party</div>
          </div>
          <div className="hp-banner-dots">
            <div className="hp-bdot on"></div><div className="hp-bdot"></div><div className="hp-bdot"></div>
          </div>
        </div>

        <div className="hp-quick-tiles">
          <div className="hp-tile hp-tile-ranking"><span className="hp-tile-label">Ranking</span><div className="hp-tile-icons">🥇🥈</div></div>
          <div className="hp-tile hp-tile-family"><span className="hp-tile-label">Family</span><div className="hp-tile-icons">👑💎</div></div>
          <div className="hp-tile hp-tile-cp"><span className="hp-tile-label">Events</span><div className="hp-tile-icons">💕✨</div></div>
        </div>

        <div className="hp-section-hdr">
          <div className="hp-section-title">🔴 Live Now</div>
          <div className="hp-see-all" onClick={()=>loadRooms(true)}>Refresh</div>
        </div>

        <div className="hp-rooms-grid">
          {roomsStatus==='loading' && <div className="hp-rooms-ph">Loading rooms...</div>}
          {roomsStatus==='empty'   && <div className="hp-rooms-ph">No live rooms right now.</div>}
          {roomsStatus==='error'   && (
            <div className="hp-rooms-ph">
              Failed to load.&nbsp;
              <span style={{color:'var(--lv-accent)',cursor:'pointer'}} onClick={()=>loadRooms(true)}>Retry</span>
            </div>
          )}
          {roomsStatus==='ok' && rooms.map((room,i)=>(
            <RoomCard key={room.id} room={room} index={i} onClick={()=>goToRoom(room)}/>
          ))}
        </div>
      </div>

      {/* ══════════════ ME ══════════════ */}
      <div className={`hp-page${mainTab==='me'?' active':''}`}>

        {/* My Room */}
        <div className="hp-my-room-section">
          <div className="hp-my-room-label">My Room</div>
          {myRoomLoading ? (
            <div style={{textAlign:'center',padding:'32px',color:'var(--lv-muted)',fontSize:'13px'}}>Loading...</div>
          ) : myRoom ? (
            <div className="hp-my-room-card" onClick={()=>navigate(`/room/${myRoom.id}`)}>
              <div className="hp-my-room-cover">{myRoom.emoji || myRoom.name?.[0] || '🎙'}</div>
              <div className="hp-my-room-info">
                <div className="hp-my-room-name">{myRoom.name}</div>
                <div className="hp-my-room-meta">
                  <span style={{fontSize:'11px',color:'var(--lv-muted)'}}>👥 {myRoom.listener_count||0} listeners • {myRoom.tag||'Chatting'}</span>
                </div>
              </div>
              <button className="hp-my-room-enter" onClick={e=>{ e.stopPropagation(); navigate(`/room/${myRoom.id}`); }}>Enter</button>
            </div>
          ) : (
            <div className="hp-my-room-empty" onClick={()=>{ console.log('[Me tab] Create room tapped'); setShowCreate(true); }}>
              <div className="hp-my-room-empty-icon">🎙️</div>
              <div className="hp-my-room-empty-text">Create your room</div>
              <div className="hp-my-room-empty-sub">Tap to get started</div>
            </div>
          )}
        </div>

        {/* Sub-tabs */}
        <div className="hp-sub-tabs">
          <div className={`hp-sub-tab${subTab==='following'?' active':''}`} onClick={()=>handleSubTab('following')}>Following</div>
          <div className={`hp-sub-tab${subTab==='recent'?' active':''}`}    onClick={()=>handleSubTab('recent')}>Recent Rooms</div>
        </div>

        {/* Following */}
        {subTab==='following' && (
          <div>
            {followStatus==='loading' && <div style={{textAlign:'center',padding:'32px',color:'var(--lv-muted)',fontSize:'13px'}}>Loading...</div>}
            {followStatus==='empty' && (
              <div className="hp-empty-state">
                <div className="hp-empty-icon">👥</div>
                <div className="hp-empty-text">No rooms followed yet</div>
                <div className="hp-empty-sub">Follow a host inside their room to see them here</div>
              </div>
            )}
            {followStatus==='error' && <div style={{textAlign:'center',padding:'32px',color:'var(--lv-muted)',fontSize:'13px'}}>Failed to load.</div>}
            {followStatus==='ok' && following.map(room=>(
              <div key={room.id} className="hp-following-card hp-flw-live" onClick={()=>goToRoom(room)}>
                <div className="hp-flw-cover" style={{background:'linear-gradient(135deg,#a78bfa,#f472b6)'}}>
                  {room.emoji||room.name?.[0]||'🎙'}
                  <div className="hp-flw-live-badge"><div className="hp-live-dot"></div> LIVE</div>
                </div>
                <div className="hp-flw-info">
                  <div className="hp-flw-room-name">{room.name}</div>
                  <div className="hp-flw-meta">
                    <span className="hp-flw-owner">{room.host_username||'?'}</span>
                    <span className="hp-flw-viewers">👥 {room.listener_count||0}</span>
                  </div>
                </div>
                <button className="hp-flw-enter-btn" onClick={e=>{ e.stopPropagation(); goToRoom(room); }}>Enter</button>
              </div>
            ))}
          </div>
        )}

        {/* Recent Rooms */}
        {subTab==='recent' && (
          <div>
            {recentRooms.length===0 ? (
              <div className="hp-empty-state">
                <div className="hp-empty-icon">🕐</div>
                <div className="hp-empty-text">No recently visited rooms</div>
              </div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
                {recentRooms.map(r=>(
                  <div key={r.id} className="hp-my-room-card" onClick={()=>navigate(`/room/${r.id}`)}>
                    <div className="hp-my-room-cover">{r.emoji||'🎙'}</div>
                    <div className="hp-my-room-info">
                      <div className="hp-my-room-name">{r.name}</div>
                      <div className="hp-my-room-meta"><span style={{fontSize:'11px',color:'var(--lv-muted)'}}>by {r.owner}</span></div>
                    </div>
                    <button className="hp-my-room-enter" onClick={e=>{ e.stopPropagation(); navigate(`/room/${r.id}`); }}>Enter</button>
                  </div>
                ))}
                <div className="hp-recent-clear" onClick={()=>{ localStorage.removeItem(RECENT_KEY); setRecentRooms([]); }}>Clear History</div>
              </div>
            )}
          </div>
        )}

      </div>
      <div className="hp-bottom-nav">
        <div className={`hp-nav-item${mainTab==='me'?' active':''}`} onClick={()=>setMainTab('me')}>
          <span className="hp-nav-icon">🏠</span><span className="hp-nav-label">Home</span>
        </div>
        <div className={`hp-nav-item${mainTab==='popular'?' active':''}`} onClick={()=>setMainTab('popular')}>
          <span className="hp-nav-icon">🔴</span><span className="hp-nav-label">Live</span>
        </div>
        <div className="hp-nav-item">
          <span className="hp-nav-icon">✉️</span><span className="hp-nav-label">Messages</span>
        </div>
        <div className="hp-nav-item" onClick={logout}>
          <span className="hp-nav-icon">
            {user?.avatar_url
              ? <img src={user.avatar_url} alt="" style={{width:24,height:24,borderRadius:'50%',objectFit:'cover'}}/>
              : '👤'}
          </span>
          <span className="hp-nav-label">Me</span>
        </div>
      </div>

      <CreateRoomModal open={showCreate} onClose={()=>setShowCreate(false)} onCreated={handleRoomCreated} hasExistingRoom={!!myRoom}/>
    </div>
  );
}
