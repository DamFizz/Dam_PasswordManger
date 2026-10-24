import { randomId } from '../lib/encoding';
import type { VaultRepository } from './db';

export interface DeviceInfo {
  id: string;
  name: string;
}

export function guessDeviceName(ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)) return 'Linux PC';
  return 'This device';
}

export async function getDevice(repo: VaultRepository): Promise<DeviceInfo> {
  let device = await repo.getLocal<DeviceInfo>('device');
  if (!device) {
    device = { id: randomId(), name: guessDeviceName() };
    await repo.setLocal('device', device);
  }
  return device;
}

export async function renameDevice(repo: VaultRepository, name: string): Promise<DeviceInfo> {
  const device = await getDevice(repo);
  const next = { ...device, name: name.trim().slice(0, 40) || device.name };
  await repo.setLocal('device', next);
  return next;
}
