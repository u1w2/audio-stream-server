import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

export interface AudioCaptureInterface {
  setCallback(callback: (data: Buffer) => void): void;
  start(): Promise<void>;
  stop(): void;
  isCapturing(): boolean;
  getActiveDevice(): string | null;
  getCaptureMethod(): string | null;
}

interface AudioDataCallback {
  (data: Buffer): void;
}

interface DshowDevice {
  name: string;
  alternativeName?: string;
}

type CapturePlan =
  | { kind: 'wasapi-loopback'; input: string; label: string }
  | { kind: 'dshow'; input: string; label: string };

export class AudioCapture implements AudioCaptureInterface {
  private audioProcess: ChildProcessWithoutNullStreams | null = null;
  private callback: AudioDataCallback | null = null;
  private isRunning = false;
  private preferredDevice: string | null = null;
  private activeDevice: string | null = null;
  private captureMethod: string | null = null;

  setPreferredDevice(deviceName: string | null): void {
    this.preferredDevice = deviceName;
  }

  setCallback(callback: AudioDataCallback): void {
    this.callback = callback;
  }

  getActiveDevice(): string | null {
    return this.activeDevice;
  }

  getCaptureMethod(): string | null {
    return this.captureMethod;
  }

  private async listDshowDevices(ffmpegPath: string): Promise<DshowDevice[]> {
    return new Promise((resolve) => {
      const probeProcess = spawn(ffmpegPath, ['-f', 'dshow', '-list_devices', 'true', '-i', 'dummy'], {
        windowsHide: true,
      });
      let output = '';
      probeProcess.stderr.on('data', (data: Buffer) => {
        output += data.toString();
      });
      probeProcess.on('close', () => {
        const devices: DshowDevice[] = [];
        const lines = output.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line.includes('(audio)') || line.includes('Alternative name')) {
            continue;
          }
          const match = line.match(/\[dshow\s+@\s+[^\]]+\]\s+"([^"]+)"\s+\(audio\)/);
          if (!match) continue;

          let alternativeName: string | undefined;
          const nextLine = lines[i + 1];
          if (nextLine?.includes('Alternative name')) {
            const altMatch = nextLine.match(/Alternative name "([^"]+)"/);
            if (altMatch) alternativeName = altMatch[1];
          }
          devices.push({ name: match[1], alternativeName });
        }
        resolve(devices);
      });
    });
  }

  private async supportsWasapi(ffmpegPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const probe = spawn(ffmpegPath, ['-hide_banner', '-formats'], { windowsHide: true });
      let output = '';
      probe.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });
      probe.stderr.on('data', (data: Buffer) => {
        output += data.toString();
      });
      probe.on('close', () => {
        resolve(/\bwasapi\b/i.test(output));
      });
    });
  }

  private async listWasapiLoopbackDevices(ffmpegPath: string): Promise<string[]> {
    return new Promise((resolve) => {
      const probe = spawn(ffmpegPath, ['-f', 'wasapi', '-list_devices', 'true', '-i', 'dummy'], {
        windowsHide: true,
      });
      let output = '';
      probe.stderr.on('data', (data: Buffer) => {
        output += data.toString();
      });
      probe.on('close', () => {
        const devices: string[] = [];
        for (const line of output.split('\n')) {
          const match = line.match(/\[wasapi\s+@\s+[^\]]+\]\s+"([^"]+\(loopback\))"/i);
          if (match) devices.push(match[1]);
        }
        resolve(devices);
      });
    });
  }

  private isStereoMixDevice(device: DshowDevice): boolean {
    return /stereo mix|立体声混音|what u hear|wave out mix|混音/i.test(device.name);
  }

  private isVirtualCableDevice(device: DshowDevice): boolean {
    return /CABLE Output|VB-Audio/i.test(device.name);
  }

  private dshowInputSpec(device: DshowDevice): string {
    if (device.alternativeName) {
      return `audio=${device.alternativeName}`;
    }
    return `audio=${device.name}`;
  }

  private async buildCapturePlan(ffmpegPath: string): Promise<CapturePlan | null> {
    if (await this.supportsWasapi(ffmpegPath)) {
      const loopbackDevices = await this.listWasapiLoopbackDevices(ffmpegPath);
      if (loopbackDevices.length > 0) {
        const preferred = this.preferredDevice
          ? loopbackDevices.find((d) => d.includes(this.preferredDevice!))
          : undefined;
        const input = preferred ?? loopbackDevices[0];
        return {
          kind: 'wasapi-loopback',
          input,
          label: input.replace(/\s*\(loopback\)/i, ''),
        };
      }
      return {
        kind: 'wasapi-loopback',
        input: 'default',
        label: '系统默认播放设备 (WASAPI Loopback)',
      };
    }

    const devices = await this.listDshowDevices(ffmpegPath);
    console.log('可用录音设备:', devices.length > 0 ? devices.map((d) => d.name).join(', ') : '无');

    if (this.preferredDevice) {
      const preferred = devices.find((d) => d.name === this.preferredDevice);
      if (preferred) {
        return {
          kind: 'dshow',
          input: this.dshowInputSpec(preferred),
          label: preferred.name,
        };
      }
    }

    const stereoMix = devices.find((d) => this.isStereoMixDevice(d));
    if (stereoMix) {
      return {
        kind: 'dshow',
        input: this.dshowInputSpec(stereoMix),
        label: `${stereoMix.name} (系统内录)`,
      };
    }

    const virtualCable = devices.find((d) => this.isVirtualCableDevice(d));
    if (virtualCable) {
      console.log(
        '提示: 未找到立体声混音，使用 VB-CABLE。若需自动捕获当前扬声器输出，请在 Windows 录音设备中启用「立体声混音」。'
      );
      return {
        kind: 'dshow',
        input: this.dshowInputSpec(virtualCable),
        label: virtualCable.name,
      };
    }

    return null;
  }

  private buildFfmpegArgs(plan: CapturePlan): string[] {
    const outputArgs = ['-acodec', 'pcm_s16le', '-ar', '48000', '-ac', '2', '-f', 's16le', '-'];

    if (plan.kind === 'wasapi-loopback') {
      return [
        '-f',
        'wasapi',
        '-loopback',
        '1',
        '-fflags',
        'nobuffer',
        '-flags',
        'low_delay',
        '-i',
        plan.input,
        ...outputArgs,
      ];
    }

    return [
      '-f',
      'dshow',
      '-fflags',
      'nobuffer',
      '-flags',
      'low_delay',
      '-i',
      plan.input,
      ...outputArgs,
    ];
  }

  async start(): Promise<void> {
    const ffmpegPath = this.getFfmpegPath();
    if (!fs.existsSync(ffmpegPath)) {
      throw new Error(`FFmpeg not found at ${ffmpegPath}`);
    }

    const plan = await this.buildCapturePlan(ffmpegPath);
    if (!plan) {
      console.log('\n⚠️  未找到可用于系统内录的设备');
      console.log('   - Windows 设置 → 声音 → 录制 → 显示已禁用设备 → 启用「立体声混音」');
      console.log('   - 或安装 VB-CABLE 并将播放设备切到 CABLE Input');
      console.log('   - 程序将使用测试音频（440Hz 正弦波）\n');
      throw new Error('No loopback audio device available');
    }

    this.activeDevice = plan.label;
    this.captureMethod = plan.kind;
    console.log(`使用捕获方式: ${plan.kind}`);
    console.log(`捕获来源: "${plan.label}"`);

    const captureArgs = this.buildFfmpegArgs(plan);

    return new Promise((resolve, reject) => {
      this.audioProcess = spawn(ffmpegPath, captureArgs, { windowsHide: true });
      let hasError = false;
      let errorMsg = '';
      let settled = false;

      this.audioProcess.stdout.on('data', (data: Buffer) => {
        if (!this.callback || !this.isRunning) return;

        const CHUNK_SIZE = 4096;
        for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
          this.callback(data.subarray(offset, offset + CHUNK_SIZE));
        }
      });

      this.audioProcess.stderr.on('data', (data: Buffer) => {
        const msg = data.toString();
        if (msg.includes('Could not enumerate') || msg.includes('Error opening')) {
          hasError = true;
          errorMsg += msg;
        }
        if (!msg.includes('Opening') && !msg.includes('Stream') && !msg.includes('frame=')) {
          console.error('Audio capture error:', msg.trim());
        }
      });

      this.audioProcess.on('error', (err: Error) => {
        this.isRunning = false;
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      this.audioProcess.on('close', (code: number) => {
        this.isRunning = false;
        if (!settled && (hasError || (code !== 0 && code !== null))) {
          settled = true;
          console.log('\n⚠️  FFmpeg 音频捕获失败:');
          console.log(`   - 来源 "${plan.label}" 可能未启用或被占用`);
          console.log('   - 立体声混音需在 Windows 录音设备中启用');
          reject(new Error(`FFmpeg exited with code ${code}: ${errorMsg}`));
        }
      });

      setTimeout(() => {
        if (settled) return;
        if (hasError) {
          settled = true;
          reject(new Error('FFmpeg failed to open audio device'));
          return;
        }
        if (this.audioProcess && !this.audioProcess.killed) {
          this.isRunning = true;
          settled = true;
          resolve();
        }
      }, 2000);
    });
  }

  stop(): void {
    this.isRunning = false;
    if (this.audioProcess) {
      this.audioProcess.kill();
      this.audioProcess = null;
    }
    this.activeDevice = null;
    this.captureMethod = null;
  }

  private getFfmpegPath(): string {
    const projectRoot = path.join(__dirname, '../..');
    const localFfmpeg = path.join(projectRoot, 'ffmpeg/ffmpeg.exe');
    if (fs.existsSync(localFfmpeg)) return localFfmpeg;

    const envPath = process.env.PATH?.split(path.delimiter).find((dir) =>
      fs.existsSync(path.join(dir, 'ffmpeg.exe'))
    );
    if (envPath) return path.join(envPath, 'ffmpeg.exe');

    const localDir = path.join(projectRoot, 'ffmpeg');
    if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
    return localFfmpeg;
  }

  isCapturing(): boolean {
    return this.isRunning;
  }
}
