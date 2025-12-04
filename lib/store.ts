// lib/store.ts

import type { PriceState } from './types';

const KEY = 'gas_price_state';

// 環境変数が設定されているかチェック
const hasRedisEnv = !!process.env.REDIS_URL;

// Redisクライアントの接続を管理（Next.js App Router用）
let redisClient: any = null;

async function getRedisClient(): Promise<any> {
  if (!redisClient) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createClient } = await import('redis');
    const client = createClient({ url: process.env.REDIS_URL });
    await client.connect();
    redisClient = client;
  }
  return redisClient;
}

// モック実装（開発用）
let mockData: PriceState | null = null;

async function loadStateMock(): Promise<PriceState | null> {
  return mockData;
}

async function saveStateMock(state: PriceState): Promise<void> {
  mockData = state;
}

// 本番実装（Redis使用）
async function loadStateRedis(): Promise<PriceState | null> {
  const client = await getRedisClient();
  const value = await client.get(KEY);
  if (!value) {
    return null;
  }
  return JSON.parse(value) as PriceState;
}

async function saveStateRedis(state: PriceState): Promise<void> {
  const client = await getRedisClient();
  await client.set(KEY, JSON.stringify(state));
}

// 環境変数に応じて実装を切り替え
export async function loadState(): Promise<PriceState | null> {
  if (hasRedisEnv) {
    try {
      return await loadStateRedis();
    } catch (error) {
      console.warn('Redis読み込みエラー、モック実装にフォールバック:', error);
      return await loadStateMock();
    }
  } else {
    console.warn(
      'Redis環境変数が設定されていません。モック実装を使用します。'
    );
    return await loadStateMock();
  }
}

export async function saveState(state: PriceState): Promise<void> {
  if (hasRedisEnv) {
    try {
      await saveStateRedis(state);
    } catch (error) {
      console.warn('Redis保存エラー、モック実装にフォールバック:', error);
      await saveStateMock(state);
    }
  } else {
    console.warn(
      'Redis環境変数が設定されていません。モック実装を使用します。'
    );
    await saveStateMock(state);
  }
}

