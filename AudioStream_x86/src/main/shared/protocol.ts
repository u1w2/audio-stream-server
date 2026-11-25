// Shared protocol constants and types between AudioStream_x86 and the server/receiver.

export const DEFAULT_CLOUD_SERVER = 'wss://www.u1w2.com';
export const DEFAULT_LOCAL_PORT = 3001;
export const HEARTBEAT_INTERVAL_MS = 300000;
export const SENDER_RECONNECT_DELAY_MS = 3000;

export const ICE_SERVERS = [
  { urls: 'stun:stun.qq.com:3478' },
  { urls: 'stun:stun.aliyun.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:39.101.174.208:3478', username: 'u1w2', credential: 'Mua04xOwvE8uBD4X' },
  { urls: 'turn:39.101.174.208:3478?transport=tcp', username: 'u1w2', credential: 'Mua04xOwvE8uBD4X' },
];

export const STUN_ONLY_ICE_SERVERS = ICE_SERVERS.filter((s) =>
  s.urls.toString().startsWith('stun:')
);

export const TURN_ONLY_ICE_SERVERS = [
  ...ICE_SERVERS,
  { iceTransportPolicy: 'relay' as any },
];

export type Mode = 'cloud' | 'lan';

export type ConnectionMode = 'p2p' | 'turn';

export interface SenderSession {
  roomCode: string;
  senderToken: string;
  wasStreaming: boolean;
}

export interface ReceiverInfo {
  receiverId: string;
  nickname: string;
  connections: number;
  netType?: string;
}

export interface RoomInfo {
  code: string;
  senderToken: string;
  maxConnections: number;
  host: string;
  qrDataUrl?: string;
  receiverUrl?: string;
  receivers: ReceiverInfo[];
}

export interface SignalingMessage {
  type: string;
  [key: string]: any;
}

export interface MdnsServiceInfo {
  name: string;
  host: string;
  port: number;
  mode: 'lan' | 'cloud';
  code?: string;
  v: number;
}
