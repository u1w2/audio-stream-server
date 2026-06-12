import { AudioCaptureInterface } from './AudioCapture';

interface AudioDataCallback {
  (data: Buffer): void;
}

export const WASAPI_OUTPUT_SAMPLE_RATE = 48000;
const POLL_INTERVAL_MS = 5;
const WS_CHUNK_SIZE = 4096;
const NATIVE_SILENCE_PAD_BYTES = 1024;

let nativeModule: { AudioCapture: new () => WasapiNativeCapture } | null = null;

interface WasapiNativeCapture {
  start(): void;
  stop(): void;
  getAudioData(): Buffer;
}

function loadNativeModule(): typeof nativeModule {
  if (nativeModule !== null) {
    return nativeModule;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nativeModule = require('wasapi-audio-capture/audiocapture.node') as {
      AudioCapture: new () => WasapiNativeCapture;
    };
    return nativeModule;
  } catch {
    nativeModule = null;
    return null;
  }
}

function clampInt16(value: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(value)));
}

function isNativeSilencePad(input: Buffer): boolean {
  if (input.length !== NATIVE_SILENCE_PAD_BYTES) {
    return false;
  }
  for (let i = 0; i < input.length; i++) {
    if (input[i] !== 0) {
      return false;
    }
  }
  return true;
}

/** Native module stores mono float32 (bug: copies nFrames*4 not stereo nFrames*8). */
function monoFloatToStereoPcm(input: Buffer): Buffer {
  const samples = Math.floor(input.length / 4);
  if (samples === 0) {
    return Buffer.alloc(0);
  }

  const output = Buffer.alloc(samples * 4);
  for (let i = 0; i < samples; i++) {
    const sample = input.readFloatLE(i * 4);
    const pcm = clampInt16(sample * 32767);
    const outOff = i * 4;
    output.writeInt16LE(pcm, outOff);
    output.writeInt16LE(pcm, outOff + 2);
  }

  return output;
}

export class WasapiLoopbackCapture implements AudioCaptureInterface {
  private callback: AudioDataCallback | null = null;
  private nativeCapture: WasapiNativeCapture | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private isRunning = false;

  static isAvailable(): boolean {
    return loadNativeModule() !== null;
  }

  setCallback(callback: AudioDataCallback): void {
    this.callback = callback;
  }

  getActiveDevice(): string | null {
    return this.isRunning ? '系统默认播放设备 (WASAPI Loopback)' : null;
  }

  getCaptureMethod(): string | null {
    return this.isRunning ? 'wasapi-native' : null;
  }

  async start(): Promise<void> {
    const mod = loadNativeModule();
    if (!mod) {
      throw new Error('WASAPI native module unavailable');
    }

    this.nativeCapture = new mod.AudioCapture();
    this.nativeCapture.start();
    this.isRunning = true;

    console.log('使用捕获方式: wasapi-native');
    console.log('捕获来源: "系统默认播放设备 (WASAPI Loopback)"');
    console.log(`输出格式: ${WASAPI_OUTPUT_SAMPLE_RATE}Hz 立体声 PCM（mono float 补偿）`);

    this.pollTimer = setInterval(() => {
      if (!this.isRunning || !this.callback || !this.nativeCapture) return;

      const raw = this.nativeCapture.getAudioData();
      if (!raw.length || isNativeSilencePad(raw)) return;

      const pcm = monoFloatToStereoPcm(raw);
      if (!pcm.length) return;

      for (let offset = 0; offset < pcm.length; offset += WS_CHUNK_SIZE) {
        this.callback(pcm.subarray(offset, offset + WS_CHUNK_SIZE));
      }
    }, POLL_INTERVAL_MS);

    return Promise.resolve();
  }

  stop(): void {
    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    // 不调用 native stop()：该模块会 std::exit(0) 终止整个 Node 进程
    this.nativeCapture = null;
  }

  isCapturing(): boolean {
    return this.isRunning;
  }
}
