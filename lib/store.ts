// lib/store.ts

import { kv } from '@vercel/kv';
import type { PriceState } from './types';

const KEY = 'gas_price_state';

export async function loadState(): Promise<PriceState | null> {
  const state = await kv.get<PriceState>(KEY);
  return state ?? null;
}

export async function saveState(state: PriceState): Promise<void> {
  await kv.set(KEY, state);
}

