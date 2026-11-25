interface ElectronApi {
  on: (channel: string, callback: (...args: any[]) => void) => void;
  off: (channel: string, callback: (...args: any[]) => void) => void;
}

const api = (window as any).electronAPI as ElectronApi;
const img = document.getElementById('qr') as HTMLImageElement;

function setQr(dataUrl: string): void {
  img.src = dataUrl;
}

api.on('qr-data', (dataUrl: string) => {
  setQr(dataUrl);
});

export {};
