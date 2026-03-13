const STUN = { urls: 'stun:stun.l.google.com:19302' };
const peers = {};

export const createPeer = (targetId, stream, onTrack, onIce) => {
  const pc = new RTCPeerConnection({ iceServers: [STUN] });
  stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  pc.ontrack = (e) => onTrack(targetId, e.streams[0]);
  pc.onicecandidate = (e) => { if (e.candidate) onIce(targetId, e.candidate); };
  peers[targetId] = pc;
  return pc;
};

export const getPeer = (id) => peers[id];
export const removePeer = (id) => { peers[id]?.close(); delete peers[id]; };
export const getLocalStream = () =>
  navigator.mediaDevices.getUserMedia({ audio: true, video: false });
