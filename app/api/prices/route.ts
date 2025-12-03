// app/api/prices/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { loadState } from '@/lib/store';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest) {
  const state = await loadState();
  return NextResponse.json({ state });
}

