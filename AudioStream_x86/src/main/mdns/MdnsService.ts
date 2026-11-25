import Bonjour from 'bonjour-service';
import { MdnsServiceInfo } from '../shared/protocol';

export class MdnsService {
  private bonjour: Bonjour | null = null;
  private service: any = null;

  publish(info: MdnsServiceInfo): void {
    if (!info.port || info.port <= 0) {
      console.warn('mDNS: skipping publish, invalid port:', info.port);
      return;
    }
    this.stop();
    try {
      this.bonjour = new Bonjour();
      // Handle bonjour-level errors gracefully — mDNS is best-effort
      (this.bonjour as any).on?.('error', (e: any) => {
        console.warn('mDNS: bonjour error (ignored):', e?.message || e);
      });
      this.service = this.bonjour.publish({
        name: `${info.name} (${info.host}) [${Date.now().toString(36)}]`,
        type: 'audiostream',
        protocol: 'tcp',
        port: info.port,
        host: info.host,
        txt: {
          v: String(info.v),
          mode: info.mode,
          code: info.code || '',
          host: info.host,
        },
      });
      // Catch async errors from the service itself (e.g. "name already in use")
      if (this.service && typeof this.service.on === 'function') {
        this.service.on('error', (e: any) => {
          console.warn('mDNS: service error (ignored):', e?.message || e);
        });
      }
    } catch (e: any) {
      console.error('mDNS publish failed:', e?.message || e);
    }
  }

  stop(): void {
    if (this.service) {
      try { this.service.stop(); } catch (_) {}
      this.service = null;
    }
    if (this.bonjour) {
      try { this.bonjour.destroy(); } catch (_) {}
      this.bonjour = null;
    }
  }
}
