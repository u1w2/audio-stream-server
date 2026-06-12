import * as os from 'os';

export class NetworkUtils {
  static getLocalIP(): string | null {
    const interfaces = os.networkInterfaces();
    
    for (const interfaceName of Object.keys(interfaces)) {
      const iface = interfaces[interfaceName];
      if (!iface) continue;
      
      for (const alias of iface) {
        if (alias.family === 'IPv4' && !alias.internal) {
          return alias.address;
        }
      }
    }
    
    return null;
  }

  static getHostname(): string {
    return os.hostname();
  }
}