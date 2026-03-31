import os from 'node:os';

export type Platform = 'mac' | 'linux' | 'windows';

export function getPlatform(): Platform {
  const p = os.platform();
  if (p === 'darwin') return 'mac';
  if (p === 'linux') return 'linux';
  if (p === 'win32') return 'windows';
  throw new Error(`Unsupported platform: ${p}. Beecork supports Mac, Linux, and Windows.`);
}
