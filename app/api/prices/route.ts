// app/api/prices/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { loadState } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // キャッシュを無効化
export const revalidate = 0; // 再検証を無効化

export async function GET(_req: NextRequest) {
  const state = await loadState();
  return NextResponse.json({ state });
}

