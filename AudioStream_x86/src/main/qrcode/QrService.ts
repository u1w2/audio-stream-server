import QRCode from 'qrcode';
import { RoomInfo } from '../shared/protocol';

export class QrService {
  async generateForRoom(room: RoomInfo): Promise<string> {
    const url = room.receiverUrl || `http://${room.host}/receiver?code=${room.code}`;
    return QRCode.toDataURL(url, {
      width: 256,
      margin: 2,
      color: { dark: '#111827', light: '#ffffff' },
    });
  }

  async generateForUrl(url: string): Promise<string> {
    return QRCode.toDataURL(url, {
      width: 256,
      margin: 2,
      color: { dark: '#111827', light: '#ffffff' },
    });
  }
}
