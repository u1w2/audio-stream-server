interface ElectronApi {
  getConfig: () => Promise<any>;
  getMode: () => Promise<'lan' | 'cloud'>;
  getRoom: () => Promise<any>;
  getReceivers: () => Promise<any[]>;
  createRoom: () => Promise<any>;
  closeRoom: () => Promise<void>;
  switchMode: (mode: 'lan' | 'cloud') => Promise<void>;
  generateQr: () => Promise<string | null>;
  copyUrl: () => Promise<void>;
  getNetworkInterfaces: () => Promise<Array<{ name: string; address: string }>>;
  setLanIp: (ip: string) => Promise<void>;
  setAutoLaunch: (enabled: boolean) => Promise<void>;
  getAudioSources: () => Promise<Array<{ id: string; name: string }>>;
  sendSignaling: (msg: any) => Promise<void>;
  on: (channel: string, callback: (...args: any[]) => void) => void;
  off: (channel: string, callback: (...args: any[]) => void) => void;
}

const api = (window as any).electronAPI as ElectronApi;

const ICE_SERVERS = [
  { urls: 'stun:stun.qq.com:3478' },
  { urls: 'stun:stun.aliyun.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:39.101.174.208:3478', username: 'u1w2', credential: 'Mua04xOwvE8uBD4X' },
  { urls: 'turn:39.101.174.208:3478?transport=tcp', username: 'u1w2', credential: 'Mua04xOwvE8uBD4X' },
];

const STUN_ONLY = ICE_SERVERS.filter((s) => s.urls.toString().startsWith('stun:'));

const OFFER_OPTIONS: any = {
  offerToReceiveAudio: false,
  offerToReceiveVideo: false,
  voiceActivityDetection: false,
};

let audioStream: MediaStream | null = null;
let localAudioTrack: MediaStreamTrack | null = null;
let pcs: Map<string, RTCPeerConnection> = new Map();
let probePcs: Map<string, RTCPeerConnection> = new Map();
let room: any = null;
let currentMode: 'lan' | 'cloud' = 'lan';
let useTurn = false;
let bitrate = 750000;
let _autoCreating = false;  // prevent concurrent auto-creates
let _switchingMode = false; // prevent mode toggle re-entry

const els = {
  roomCode: document.getElementById('roomCode') as HTMLDivElement,
  roomUrl: document.getElementById('roomUrl') as HTMLDivElement,
  qrArea: document.getElementById('qrArea') as HTMLDivElement,
  lanLabel: document.getElementById('lanLabel') as HTMLSpanElement,
  cloudLabel: document.getElementById('cloudLabel') as HTMLSpanElement,
  ifaceSelect: document.getElementById('ifaceSelect') as HTMLSelectElement,
  modeToggle: document.getElementById('modeToggle') as HTMLInputElement,
  btnRecreate: document.getElementById('btnRecreate') as HTMLButtonElement,
  btnClose: document.getElementById('btnClose') as HTMLButtonElement,
  btnCopy: document.getElementById('btnCopy') as HTMLButtonElement,
  statusDot: document.getElementById('statusDot') as HTMLSpanElement,
  statusText: document.getElementById('statusText') as HTMLSpanElement,
  audioSource: document.getElementById('audioSource') as HTMLSelectElement,
  audioDot: document.getElementById('audioDot') as HTMLSpanElement,
  audioText: document.getElementById('audioText') as HTMLSpanElement,
  receiverList: document.getElementById('receiverList') as HTMLUListElement,
  log: document.getElementById('log') as HTMLDivElement,
};

function log(msg: string): void {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  els.log.textContent += line + '\n';
  els.log.scrollTop = els.log.scrollHeight;
}

// ── Init: auto‑create room & show QR ──

async function init(): Promise<void> {
  currentMode = await api.getMode();
  room = await api.getRoom();
  updateModeUI();
  updateRoomUI();

  // 音频捕获 → 自动创建房间
  await loadAudioSources();
  await ensureAudioCapture();

  await loadNetworkInterfaces();

  if (!room) {
    await autoCreateRoom();
  } else {
    log(`已恢复房间: ${room.code}`);
    updateRoomUI();
    updateQrInline();
  }

  setupEventListeners();
  setupIpcListeners();
  log('AudioStream Sender 已就绪');
}

async function updateQrInline(): Promise<void> {
  try {
    const dataUrl = await api.generateQr();
    if (dataUrl) {
      els.qrArea.innerHTML = `<img src="${dataUrl}" alt="扫码加入">`;
    }
  } catch (_) {}
}

async function autoCreateRoom(): Promise<void> {
  if (_autoCreating) return;
  _autoCreating = true;
  try {
    els.statusDot.className = 'dot warn';
    els.statusText.textContent = '正在创建房间…';
    room = await api.createRoom();
    updateRoomUI();
    updateQrInline();
    log(`自动创建房间: ${room.code}`);
  } catch (e) {
    log('自动创建房间失败: ' + (e as Error).message);
    els.statusDot.className = 'dot error';
    els.statusText.textContent = '房间创建失败，请点击重新创建';
  } finally {
    _autoCreating = false;
  }
}

// ── Mode toggle ──

function updateModeUI(): void {
  const isLan = currentMode === 'lan';
  els.modeToggle.checked = !isLan; // checked = cloud
  els.lanLabel.classList.toggle('active', isLan);
  els.cloudLabel.classList.toggle('active', !isLan);
  els.ifaceSelect.classList.toggle('hidden', !isLan);
}

async function loadNetworkInterfaces(): Promise<void> {
  try {
    const ifaces = await api.getNetworkInterfaces();
    els.ifaceSelect.innerHTML = ifaces.map((iface) =>
      `<option value="${iface.address}">${iface.name} (${iface.address})</option>`
    ).join('');
    // Select current IP if known
    if (room?.receiverUrl) {
      try {
        const url = new URL(room.receiverUrl);
        els.ifaceSelect.value = url.hostname;
      } catch (_) {}
    }
  } catch (e) {
    log('获取网卡列表失败: ' + (e as Error).message);
  }
}

async function onInterfaceChange(): Promise<void> {
  const ip = els.ifaceSelect.value;
  if (!ip) return;
  log(`切换网卡 → ${ip}`);
  els.statusDot.className = 'dot warn';
  els.statusText.textContent = '正在切换…';
  await closeAllPeerConnections();
  try { await api.setLanIp(ip); } catch (e) { log('切换 IP 失败: ' + (e as Error).message); }
  // room-created will fire and update UI
}

async function onModeToggleChange(): Promise<void> {
  if (_switchingMode) return;
  const wantCloud = els.modeToggle.checked;
  const newMode: 'lan' | 'cloud' = wantCloud ? 'cloud' : 'lan';
  if (newMode === currentMode) return;

  _switchingMode = true;
  log(`切换模式 → ${wantCloud ? '公网' : '局域网'}`);
  els.statusDot.className = 'dot warn';
  els.statusText.textContent = '正在切换模式…';

  // Close current room first
  await closeAllPeerConnections();
  try { await api.closeRoom(); } catch (_) {}

  // Switch mode
  await api.switchMode(newMode);
  // currentMode updated by ipc listener → updateModeUI called
  // After mode switch, auto-create new room
  room = null;
  updateRoomUI();
  await autoCreateRoom();
  _switchingMode = false;
}

// ── Event listeners ──

function setupEventListeners(): void {
  els.modeToggle.addEventListener('change', () => {
    onModeToggleChange().catch((e) => log('模式切换失败: ' + e.message));
  });

  els.ifaceSelect.addEventListener('change', () => {
    onInterfaceChange().catch((e) => log('网卡切换失败: ' + e.message));
  });

  els.btnRecreate.addEventListener('click', async () => {
    // Close existing → create fresh
    await closeAllPeerConnections();
    try { await api.closeRoom(); } catch (_) {}
    room = null;
    updateRoomUI();
    // QR will refresh on next room creation
    els.statusDot.className = 'dot warn';
    els.statusText.textContent = '正在重新创建…';
    await autoCreateRoom();
  });

  els.btnClose.addEventListener('click', async () => {
    await closeAllPeerConnections();
    try { await api.closeRoom(); } catch (_) {}
    room = null;
    // QR will refresh on next room creation
    updateRoomUI();
    els.statusDot.className = 'dot';
    els.statusText.textContent = '已停止推流';
    log('已停止推流');
  });

  els.btnCopy.addEventListener('click', () => api.copyUrl());

  els.audioSource.addEventListener('change', async () => {
    stopAudioCapture();
    await ensureAudioCapture();
    // Re-attach track to existing peer connections
    if (localAudioTrack && audioStream) {
      pcs.forEach((pc) => {
        const senders = pc.getSenders().filter((s) => s.track?.kind === 'audio');
        senders.forEach((s) => s.replaceTrack(localAudioTrack!).catch(() => {}));
        if (senders.length === 0) {
          pc.addTrack(localAudioTrack!, audioStream!);
        }
      });
      log('已切换音频源');
    }
  });
}

function setupIpcListeners(): void {
  api.on('second-instance', () => {
    log('已有实例运行中，前置窗口');
    if (!room) {
      ensureAudioCapture().then(() => autoCreateRoom()).catch(() => {});
    }
  });

  api.on('mode-changed', (mode: 'lan' | 'cloud') => {
    currentMode = mode;
    updateModeUI();
    log(`信令模式: ${mode === 'lan' ? '局域网' : '公网'}`);
  });

  api.on('room-created', (r: any) => {
    room = r;
    updateRoomUI();
    log(`房间已创建: ${r.code}`);
    updateQrInline();
    loadNetworkInterfaces().catch(() => {});
  });

  api.on('room-resumed', (r: any) => {
    room = r;
    updateRoomUI();
    log(`房间已恢复: ${r.code}`);
    updateQrInline();
    loadNetworkInterfaces().catch(() => {});
  });

  api.on('room-closed', () => {
    room = null;
    closeAllPeerConnections();
    updateRoomUI();
  });

  api.on('peer-joined', (receiver: any) => {
    log(`听众加入: ${receiver.nickname || '未命名'} (${receiver.receiverId})`);
    updateReceiverList();
    createPeerConnection(receiver.receiverId, false).catch((e) => log(e.message));
  });

  api.on('peer-left', (receiverId: string) => {
    log(`听众离开: ${receiverId}`);
    closePeerConnection(receiverId);
    updateReceiverList();
  });

  api.on('signaling-from-receiver', async ({ receiverId, msg }: { receiverId: string; msg: any }) => {
    await handleReceiverSignaling(receiverId, msg);
  });
}

// ── UI helpers ──

function updateRoomUI(): void {
  if (room) {
    els.roomCode.textContent = room.code;
    els.roomCode.classList.remove('muted');
    els.roomUrl.textContent = room.receiverUrl || '';
    els.btnRecreate.disabled = false;
    els.btnClose.disabled = false;
    els.btnCopy.disabled = false;
    els.statusDot.className = 'dot active';
    els.statusText.textContent = '房间运行中';
  } else {
    els.roomCode.textContent = '---';
    els.roomCode.classList.add('muted');
    els.roomUrl.textContent = '';
    els.qrArea.innerHTML = '<div class="qr-placeholder">扫码加入</div>';
    els.btnRecreate.disabled = true;
    els.btnClose.disabled = true;
    els.btnCopy.disabled = true;
    els.statusDot.classList.remove('active', 'error');
    els.statusDot.classList.add('dot');
    els.statusText.textContent = '未创建房间';
  }
}

async function updateReceiverList(): Promise<void> {
  const receivers = await api.getReceivers();
  if (receivers.length === 0) {
    els.receiverList.innerHTML = '<li class="muted">暂无听众</li>';
    return;
  }
  els.receiverList.innerHTML = receivers
    .map((r) => `<li><span>${r.nickname}</span><span class="muted">${r.receiverId}</span></li>`)
    .join('');
}

// ── WebRTC ──

async function ensureAudioCapture(): Promise<void> {
  try {
    if (audioStream) return;

    const sourceId = els.audioSource.value || 'screen:0:0';
    const constraints: any = {
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
        },
      },
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
        },
      },
    };

    audioStream = await navigator.mediaDevices.getUserMedia(constraints);
    const videoTracks = audioStream.getVideoTracks();
    videoTracks.forEach((t) => t.stop());
    audioStream = new MediaStream(audioStream.getAudioTracks());
    localAudioTrack = audioStream.getAudioTracks()[0] || null;

    els.audioDot.classList.add('active');
    els.audioText.textContent = localAudioTrack
      ? `已捕获: ${localAudioTrack.label || '系统音频'}`
      : '未捕获到音频轨道';
    log('音频捕获成功');
  } catch (e) {
    log('音频捕获失败: ' + (e as Error).message);
    els.audioDot.classList.add('error');
    els.audioText.textContent = '音频捕获失败';
  }
}

async function loadAudioSources(): Promise<void> {
  try {
    const sources = await api.getAudioSources();
    els.audioSource.innerHTML = '<option value="">自动选择系统音频</option>';
    sources.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      els.audioSource.appendChild(opt);
    });
  } catch (e) {
    log('获取音频源失败: ' + (e as Error).message);
  }
}

async function createPeerConnection(receiverId: string, turn: boolean): Promise<RTCPeerConnection> {
  if (pcs.has(receiverId)) {
    closePeerConnection(receiverId);
  }

  const iceServers = turn ? ICE_SERVERS : STUN_ONLY;
  const pc = new RTCPeerConnection({ iceServers });
  pcs.set(receiverId, pc);

  if (localAudioTrack) {
    pc.addTrack(localAudioTrack, audioStream!);
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      api.sendSignaling({
        type: 'webrtc-ice',
        targetReceiverId: receiverId,
        candidate: e.candidate.toJSON(),
      });
    }
  };

  pc.oniceconnectionstatechange = () => {
    log(`[${receiverId}] ICE: ${pc.iceConnectionState}`);
  };

  pc.onconnectionstatechange = () => {
    log(`[${receiverId}] 连接: ${pc.connectionState}`);
    if (pc.connectionState === 'connected') {
      log(`[${receiverId}] WebRTC 已连接 ✓`);
    } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      log(`[${receiverId}] 连接断开，尝试重连…`);
      restartP2P(receiverId);
    }
  };

  pc.ontrack = () => {}; // sender side — no incoming tracks expected

  // Use a flag to prevent onnegotiationneeded from racing with explicit offer
  let negotiating = false;
  pc.onnegotiationneeded = async () => {
    if (negotiating) return;
    negotiating = true;
    try {
      const offer = await pc.createOffer(OFFER_OPTIONS);
      await pc.setLocalDescription(offer);
      tuneBitrate(offer.sdp, bitrate);
      api.sendSignaling({
        type: 'webrtc-offer',
        targetReceiverId: receiverId,
        useTURN: turn,
        sdp: pc.localDescription!.toJSON(),
      });
      log(`[${receiverId}] Offer 已发送 (renegotiation)`);
    } catch (e) {
      log(`[${receiverId}] renegotiation 失败: ${(e as Error).message}`);
    } finally {
      negotiating = false;
    }
  };

  // Create and send initial offer
  negotiating = true;
  try {
    const offer = await pc.createOffer(OFFER_OPTIONS);
    await pc.setLocalDescription(offer);
    tuneBitrate(offer.sdp, bitrate);
    api.sendSignaling({
      type: 'webrtc-offer',
      targetReceiverId: receiverId,
      useTURN: turn,
      sdp: pc.localDescription!.toJSON(),
    });
    log(`[${receiverId}] Offer 已发送`);
  } catch (e) {
    log(`[${receiverId}] 创建 Offer 失败: ${(e as Error).message}`);
  } finally {
    negotiating = false;
  }

  return pc;
}

async function handleReceiverSignaling(receiverId: string, msg: any): Promise<void> {
  if (msg.type === 'webrtc-answer') {
    const pc = pcs.get(receiverId);
    if (pc && msg.sdp) {
      await pc.setRemoteDescription(msg.sdp);
      log(`[${receiverId}] 已设置远端 answer`);
    }
  } else if (msg.type === 'webrtc-ice') {
    const pc = pcs.get(receiverId);
    if (pc && msg.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
    }
  } else if (msg.type === 'bitrate-change') {
    bitrate = msg.bitrate || 750000;
    const pc = pcs.get(receiverId);
    if (pc?.localDescription) {
      await tuneBitrate(pc.localDescription.sdp, bitrate);
    }
  } else if (msg.type === 'connection-lost') {
    log(`[${receiverId}] 对端报告连接丢失，尝试 ICE restart`);
    await iceRestart(receiverId);
  } else if (msg.type === 'network-changed') {
    log(`[${receiverId}] 对端网络变化`);
  } else if (msg.type === 'force-rejoin') {
    closePeerConnection(receiverId);
  }
}

function restartP2P(receiverId: string): void {
  log(`[${receiverId}] 重新建立 P2P 连接…`);
  closePeerConnection(receiverId);
  if (localAudioTrack && audioStream) {
    createPeerConnection(receiverId, false).catch((e) => log(e.message));
  }
}

async function iceRestart(receiverId: string): Promise<void> {
  const pc = pcs.get(receiverId);
  if (!pc) return;
  try {
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    api.sendSignaling({
      type: 'webrtc-offer',
      targetReceiverId: receiverId,
      useTURN: useTurn,
      iceRestart: true,
      sdp: pc.localDescription!.toJSON(),
    });
  } catch (e) {
    log(`ICE restart 失败: ${(e as Error).message}`);
  }
}

async function tuneBitrate(sdp: string | null | undefined, bps: number): Promise<void> {
  if (!sdp) return;
  log(`目标码率: ${Math.round(bps / 1000)} kbps`);
}

function closePeerConnection(receiverId: string): void {
  const pc = pcs.get(receiverId);
  if (pc) {
    pc.close();
    pcs.delete(receiverId);
  }
}

function closeAllPeerConnections(): void {
  pcs.forEach((pc) => pc.close());
  pcs.clear();
  probePcs.forEach((pc) => pc.close());
  probePcs.clear();
}

function stopAudioCapture(): void {
  audioStream?.getTracks().forEach((t) => t.stop());
  audioStream = null;
  localAudioTrack = null;
  els.audioDot.classList.remove('active', 'error');
  els.audioText.textContent = '未捕获音频';
}

init().catch((e) => log('初始化失败: ' + e.message));

export {};
