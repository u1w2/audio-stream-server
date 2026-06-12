import { AudioCaptureInterface } from './AudioCapture';

interface AudioDataCallback {
  (data: Buffer): void;
}

export class AudioCaptureFallback implements AudioCaptureInterface {
  private callback: AudioDataCallback | null = null;
  private isRunning = false;
  private intervalId: any = null;
  private sampleIndex = 0;
  private readonly SAMPLE_RATE = 44100;
  private readonly FREQUENCY = 440;

  setCallback(callback: AudioDataCallback): void {
    this.callback = callback;
  }

  private generateSineWave(numSamples: number): Buffer {
    const buffer = Buffer.alloc(numSamples * 2 * 2);
    
    for (let i = 0; i < numSamples; i++) {
      const sample = Math.sin(2 * Math.PI * this.FREQUENCY * this.sampleIndex / this.SAMPLE_RATE);
      const intSample = Math.floor(sample * 16000);
      const int16Sample = Math.max(-32768, Math.min(32767, intSample));
      
      const leftChannel = i * 4;
      const rightChannel = i * 4 + 2;
      
      buffer.writeInt16LE(int16Sample, leftChannel);
      buffer.writeInt16LE(int16Sample, rightChannel);
      
      this.sampleIndex++;
    }
    
    return buffer;
  }

  async start(): Promise<void> {
    this.isRunning = true;
    console.log('🎵 Fallback mode: Generating test audio (440Hz sine wave)');
    
    const samplesPerBuffer = 2048;
    const intervalMs = (samplesPerBuffer / this.SAMPLE_RATE) * 1000;

    this.intervalId = setInterval(() => {
      if (!this.isRunning || !this.callback) return;
      
      const audioBuffer = this.generateSineWave(samplesPerBuffer);
      this.callback(audioBuffer);
    }, intervalMs);

    return Promise.resolve();
  }

  stop(): void {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  isCapturing(): boolean {
    return this.isRunning;
  }

  getActiveDevice(): string | null {
    return this.isRunning ? '440Hz 测试音' : null;
  }

  getCaptureMethod(): string | null {
    return this.isRunning ? 'fallback-sine' : null;
  }
}