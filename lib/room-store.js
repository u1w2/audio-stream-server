const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'rooms.json');

const ROOM_TTL_MS = parseInt(process.env.ROOM_TTL_MS, 10) || 2 * 60 * 60 * 1000;
const RECEIVER_SLOT_TTL_MS = parseInt(process.env.RECEIVER_SLOT_TTL_MS, 10) || 24 * 60 * 60 * 1000;
const SENDER_GRACE_MS = parseInt(process.env.SENDER_GRACE_MS, 10) || 120 * 1000;
const RECEIVER_GRACE_MS = parseInt(process.env.RECEIVER_GRACE_MS, 10) || 60 * 1000;

const CLIENT_ID_RE = /^bc-[a-f0-9]{16}$/;
const NICKNAME_RE = /^[\u4e00-\u9fa5a-zA-Z0-9]{1,16}$/;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadAll() {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) {
    return { rooms: {}, version: 1 };
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { rooms: {}, version: 1 };
    if (!parsed.rooms || typeof parsed.rooms !== 'object') parsed.rooms = {};
    return parsed;
  } catch (_) {
    return { rooms: {}, version: 1 };
  }
}

function saveAll(store) {
  ensureDataDir();
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

function getRecord(store, code) {
  return store.rooms[code] || null;
}

function upsertRoom(store, record) {
  store.rooms[record.code] = record;
  saveAll(store);
  return record;
}

function removeRoom(store, code) {
  if (store.rooms[code]) {
    delete store.rooms[code];
    saveAll(store);
  }
}

function touchRoom(record, now = Date.now()) {
  record.lastActivityAt = now;
  return record;
}

function isRoomExpired(record, now = Date.now()) {
  if (!record) return true;
  const last = record.lastActivityAt || record.createdAt || 0;
  return now - last > ROOM_TTL_MS;
}

function isSlotExpired(slot, now = Date.now()) {
  if (!slot) return true;
  const last = slot.lastSeenAt || 0;
  return now - last > RECEIVER_SLOT_TTL_MS;
}

function purgeExpired(store, now = Date.now()) {
  let changed = false;
  for (const [code, record] of Object.entries(store.rooms)) {
    if (isRoomExpired(record, now)) {
      delete store.rooms[code];
      changed = true;
      continue;
    }
    const before = record.receivers?.length || 0;
    record.receivers = (record.receivers || []).filter((s) => !isSlotExpired(s, now));
    if (record.receivers.length !== before) changed = true;
  }
  if (changed) saveAll(store);
  return store;
}

function generateToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

function validateClientId(clientId) {
  return typeof clientId === 'string' && CLIENT_ID_RE.test(clientId);
}

function validateNickname(nickname) {
  if (typeof nickname !== 'string') return false;
  const trimmed = nickname.trim();
  return trimmed.length >= 1 && trimmed.length <= 16 && NICKNAME_RE.test(trimmed);
}

function normalizeNickname(nickname) {
  return nickname.trim();
}

function nicknameKey(nickname) {
  return normalizeNickname(nickname).toLowerCase();
}

function buildSlotIndexes(record) {
  const byClientId = {};
  const byNickname = {};
  for (const slot of record.receivers || []) {
    if (slot.clientId) byClientId[slot.clientId] = slot;
    if (slot.nickname) byNickname[nicknameKey(slot.nickname)] = slot;
  }
  return { byClientId, byNickname };
}

function findSlot(record, { resumeReceiverId, joinToken, clientId }, now = Date.now()) {
  const receivers = record.receivers || [];
  if (resumeReceiverId && joinToken) {
    const slot = receivers.find(
      (s) => s.receiverId === resumeReceiverId && !isSlotExpired(s, now)
    );
    if (slot && safeEqual(slot.joinToken, joinToken)) return { slot, reason: 'token' };
  }
  if (clientId && validateClientId(clientId)) {
    const slot = receivers.find(
      (s) => s.clientId === clientId && !isSlotExpired(s, now)
    );
    if (slot) return { slot, reason: 'clientId' };
  }
  return { slot: null, reason: null };
}

function isNicknameTaken(record, nickname, exceptReceiverId, now = Date.now()) {
  const key = nicknameKey(nickname);
  for (const slot of record.receivers || []) {
    if (isSlotExpired(slot, now)) continue;
    if (exceptReceiverId && slot.receiverId === exceptReceiverId) continue;
    if (slot.nickname && nicknameKey(slot.nickname) === key) return true;
  }
  return false;
}

function upsertSlot(record, slotData, now = Date.now()) {
  if (!record.receivers) record.receivers = [];
  const idx = record.receivers.findIndex((s) => s.receiverId === slotData.receiverId);
  const slot = {
    receiverId: slotData.receiverId,
    joinToken: slotData.joinToken,
    clientId: slotData.clientId || '',
    nickname: slotData.nickname || '',
    lastSeenAt: now,
  };
  if (idx === -1) record.receivers.push(slot);
  else record.receivers[idx] = { ...record.receivers[idx], ...slot };
  touchRoom(record, now);
  return slot;
}

function removeSlot(record, receiverId) {
  if (!record.receivers) return;
  record.receivers = record.receivers.filter((s) => s.receiverId !== receiverId);
}

function touchSlot(record, receiverId, now = Date.now()) {
  const slot = (record.receivers || []).find((s) => s.receiverId === receiverId);
  if (slot) {
    slot.lastSeenAt = now;
    touchRoom(record, now);
  }
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function createEmptyRecord(code, { senderToken, maxConnections, host }) {
  const now = Date.now();
  return {
    code,
    senderToken,
    maxConnections,
    host: host || 'www.u1w2.com',
    receiverCount: 0,
    createdAt: now,
    lastActivityAt: now,
    receivers: [],
  };
}

function listReceiverSummaries(record, now = Date.now()) {
  return (record.receivers || [])
    .filter((s) => !isSlotExpired(s, now))
    .map((s) => ({ receiverId: s.receiverId, nickname: s.nickname || s.receiverId }));
}

function syncRecordFromMemory(record, room, now = Date.now()) {
  record.maxConnections = room.maxConnections;
  record.receiverCount = room.receiverCount;
  record.host = room._host || record.host;
  touchRoom(record, now);
  for (const rws of room.receivers) {
    if (!rws._receiverId) continue;
    const existing = (record.receivers || []).find((s) => s.receiverId === rws._receiverId);
    if (existing) {
      existing.lastSeenAt = now;
      if (rws._nickname) existing.nickname = rws._nickname;
      if (rws._clientId) existing.clientId = rws._clientId;
    }
  }
  return record;
}

module.exports = {
  DATA_FILE,
  ROOM_TTL_MS,
  RECEIVER_SLOT_TTL_MS,
  SENDER_GRACE_MS,
  RECEIVER_GRACE_MS,
  CLIENT_ID_RE,
  NICKNAME_RE,
  loadAll,
  saveAll,
  getRecord,
  upsertRoom,
  removeRoom,
  touchRoom,
  isRoomExpired,
  isSlotExpired,
  purgeExpired,
  generateToken,
  validateClientId,
  validateNickname,
  normalizeNickname,
  nicknameKey,
  buildSlotIndexes,
  findSlot,
  isNicknameTaken,
  upsertSlot,
  removeSlot,
  touchSlot,
  safeEqual,
  createEmptyRecord,
  listReceiverSummaries,
  syncRecordFromMemory,
};
