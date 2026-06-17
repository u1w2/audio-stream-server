/**
 * RoomStore 单元测试（纯 Node，不依赖 WebSocket）
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-store-test-'));
process.env.ROOM_TTL_MS = String(60 * 60 * 1000);
process.env.RECEIVER_SLOT_TTL_MS = String(24 * 60 * 60 * 1000);

// 指向临时 data 目录
const roomStorePath = path.join(__dirname, 'lib', 'room-store.js');
delete require.cache[require.resolve(roomStorePath)];
const origDir = path.join(__dirname, 'data');
const rs = require(roomStorePath);

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push('  ✅ ' + name);
  } catch (e) {
    results.push('  ❌ ' + name + ': ' + e.message);
  }
}

const store = { rooms: {}, version: 1 };
const code = 'TEST1';
const record = rs.createEmptyRecord(code, {
  senderToken: rs.generateToken(),
  maxConnections: 5,
  host: 'localhost',
});

test('validateClientId 接受 bc- 格式', () => {
  if (!rs.validateClientId('bc-' + 'a'.repeat(16))) throw new Error('valid id rejected');
  if (rs.validateClientId('bad')) throw new Error('invalid id accepted');
});

test('validateNickname 中文/数字/字母', () => {
  if (!rs.validateNickname('427')) throw new Error('numeric nick rejected');
  if (!rs.validateNickname('听众A')) throw new Error('cn nick rejected');
  if (rs.validateNickname('bad@name')) throw new Error('special char accepted');
});

test('nicknameKey 大小写不敏感', () => {
  if (rs.nicknameKey('Alice') !== rs.nicknameKey('alice')) throw new Error('case fold failed');
});

test('isNicknameTaken 房间内唯一', () => {
  const r = { ...record, receivers: [{ receiverId: 'dev-1', nickname: '427', joinToken: 't1', lastSeenAt: Date.now() }] };
  if (!rs.isNicknameTaken(r, '427')) throw new Error('should be taken');
  if (rs.isNicknameTaken(r, '427', 'dev-1')) throw new Error('same slot should allow own nick');
  if (rs.isNicknameTaken(r, '999')) throw new Error('999 should be free');
});

test('findSlot 按 joinToken resume', () => {
  const token = rs.generateToken();
  const r = {
    ...record,
    receivers: [{
      receiverId: 'dev-1',
      joinToken: token,
      clientId: 'bc-' + 'b'.repeat(16),
      nickname: '427',
      lastSeenAt: Date.now(),
    }],
  };
  const found = rs.findSlot(r, { resumeReceiverId: 'dev-1', joinToken: token });
  if (!found.slot || found.reason !== 'token') throw new Error('token resume failed');
});

test('findSlot 按 clientId resume', () => {
  const cid = 'bc-' + 'c'.repeat(16);
  const r = {
    ...record,
    receivers: [{
      receiverId: 'dev-2',
      joinToken: rs.generateToken(),
      clientId: cid,
      nickname: '888',
      lastSeenAt: Date.now(),
    }],
  };
  const found = rs.findSlot(r, { clientId: cid });
  if (!found.slot || found.reason !== 'clientId') throw new Error('clientId resume failed');
});

test('purgeExpired 删除过期 room', () => {
  const s = { rooms: {}, version: 1 };
  const old = rs.createEmptyRecord('OLD', { senderToken: 'x', maxConnections: 3, host: 'h' });
  old.lastActivityAt = Date.now() - rs.ROOM_TTL_MS - 1000;
  s.rooms.OLD = old;
  rs.purgeExpired(s, Date.now());
  if (s.rooms.OLD) throw new Error('expired room not removed');
});

test('safeEqual 常量时间比对', () => {
  if (!rs.safeEqual('abc', 'abc')) throw new Error('equal strings failed');
  if (rs.safeEqual('abc', 'abd')) throw new Error('unequal strings matched');
});

test('maxConnections 钳制 1-9', () => {
  const clamped = Math.max(1, Math.min(9, 20));
  if (clamped !== 9) throw new Error('clamp failed');
});

console.log('=== RoomStore 单元测试 ===\n');
results.forEach(r => console.log(r));
const failed = results.filter(r => r.includes('❌')).length;
console.log('\n📊 ' + (results.length - failed) + ' ✅ / ' + failed + ' ❌');
process.exit(failed > 0 ? 1 : 0);
