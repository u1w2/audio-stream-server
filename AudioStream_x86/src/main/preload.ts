import { contextBridge, ipcRenderer, desktopCapturer } from 'electron';
import { Mode, RoomInfo, ReceiverInfo, SignalingMessage } from '../main/shared/protocol';

export interface ElectronApi {
  getConfig: () => Promise<any>;
  getMode: () => Promise<Mode>;
  getRoom: () => Promise<RoomInfo | null>;
  getReceivers: () => Promise<ReceiverInfo[]>;
  createRoom: () => Promise<RoomInfo | null>;
  closeRoom: () => Promise<void>;
  switchMode: (mode: Mode) => Promise<void>;
  showQr: () => Promise<void>;
  generateQr: () => Promise<string | null>;
  copyUrl: () => Promise<void>;
  getNetworkInterfaces: () => Promise<Array<{ name: string; address: string }>>;
  setLanIp: (ip: string) => Promise<void>;
  setAutoLaunch: (enabled: boolean) => Promise<void>;
  getAudioSources: () => Promise<Array<{ id: string; name: string }>>;
  sendSignaling: (msg: SignalingMessage) => Promise<void>;
  on: (channel: string, callback: (...args: any[]) => void) => void;
  off: (channel: string, callback: (...args: any[]) => void) => void;
}

const api: ElectronApi = {
  getConfig: () => ipcRenderer.invoke('app:get-config'),
  getMode: () => ipcRenderer.invoke('app:get-mode'),
  getRoom: () => ipcRenderer.invoke('app:get-room'),
  getReceivers: () => ipcRenderer.invoke('app:get-receivers'),
  createRoom: () => ipcRenderer.invoke('app:create-room'),
  closeRoom: () => ipcRenderer.invoke('app:close-room'),
  switchMode: (mode: Mode) => ipcRenderer.invoke('app:switch-mode', mode),
  showQr: () => ipcRenderer.invoke('app:show-qr'),
  generateQr: () => ipcRenderer.invoke('app:generate-qr'),
  copyUrl: () => ipcRenderer.invoke('app:copy-url'),
  getNetworkInterfaces: () => ipcRenderer.invoke('app:get-network-interfaces'),
  setLanIp: (ip: string) => ipcRenderer.invoke('app:set-lan-ip', ip),
  setAutoLaunch: (enabled: boolean) => ipcRenderer.invoke('app:set-auto-launch', enabled),
  getAudioSources: () => ipcRenderer.invoke('app:get-audio-sources'),
  sendSignaling: (msg: SignalingMessage) => ipcRenderer.invoke('app:signaling-send', msg),
  on: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.on(channel, (_, ...args) => callback(...args));
  },
  off: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.removeListener(channel, callback);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
