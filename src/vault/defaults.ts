import { randomId } from '../lib/encoding';
import type { Collection } from './types';

/** Starter categories created with a new vault. Users can rename, recolour or delete them. */
const STARTER_CATEGORIES: { name: string; icon: string; color: string }[] = [
  { name: 'Social Media', icon: 'message-circle', color: '#ec4899' },
  { name: 'Gaming', icon: 'gamepad', color: '#8b5cf6' },
  { name: 'Finance', icon: 'landmark', color: '#10b981' },
  { name: 'Work', icon: 'briefcase', color: '#3b82f6' },
  { name: 'Education', icon: 'graduation-cap', color: '#f59e0b' },
  { name: 'Email', icon: 'mail', color: '#06b6d4' },
  { name: 'Shopping', icon: 'shopping-bag', color: '#f97316' },
  { name: 'Entertainment', icon: 'clapperboard', color: '#ef4444' },
];

export function starterCollections(now = Date.now()): Collection[] {
  return STARTER_CATEGORIES.map((c, i) => ({
    id: randomId(),
    kind: 'category' as const,
    name: c.name,
    icon: c.icon,
    color: c.color,
    parentId: null,
    pinned: false,
    order: i,
    createdAt: now,
    updatedAt: now,
  }));
}
