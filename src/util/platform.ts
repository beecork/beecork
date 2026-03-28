import os from 'node:os';

export type Platform = 'mac' | 'linux';

export function getPlatform(): Platform {
  const p = os.platform();
  if (p === 'darwin') return 'mac';
  if (p === 'linux') return 'linux';
  throw new Error(`Unsupported platform: ${p}. Beecork supports Mac and Linux.`);
}
