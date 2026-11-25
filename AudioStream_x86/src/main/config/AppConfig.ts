import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { Mode } from '../shared/protocol';

const getConfigDir = () => app?.getPath?.('userData') ?? path.join(process.cwd(), 'userData');
const getConfigFile = () => path.join(getConfigDir(), 'config.json');

export interface AppConfig {
  defaultMode: Mode;
  cloudServer: string;
  localPort: number;
  maxConnections: number;
  autoLaunch: boolean;
  showWindowOnStart: boolean;
  minBitrate: number;
  maxBitrate: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  defaultMode: 'lan',
  cloudServer: 'wss://www.u1w2.com',
  localPort: 3001,
  maxConnections: 5,
  autoLaunch: false,
  showWindowOnStart: true,
  minBitrate: 16000,
  maxBitrate: 750000,
};

export function loadConfig(): AppConfig {
  const CONFIG_FILE = getConfigFile();
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return { ...DEFAULT_CONFIG };
    }
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (e) {
    console.error('加载配置失败:', e);
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: AppConfig): void {
  const CONFIG_DIR = getConfigDir();
  const CONFIG_FILE = getConfigFile();
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.error('保存配置失败:', e);
  }
}
