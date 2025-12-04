// app/api/update-prices/route.ts

import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getWeeklyFileUrl } from '@/lib/enecho';
import { buildPriceStateFromWorkbook } from '@/lib/weekly';
import { loadState, saveState } from '@/lib/store';

export const runtime = 'nodejs';

export async function POST(_req: NextRequest) {
  try {
    const current = await loadState();

    // 1. 週次ファイルURL取得
    const weeklyUrl = await getWeeklyFileUrl();

    // 2. Excel取得
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒タイムアウト

    let resp: Response;
    try {
      resp = await fetch(weeklyUrl, {
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('週次ファイル取得がタイムアウトしました');
      }
      throw error;
    }

    if (!resp.ok) {
      throw new Error(`週次ファイル取得に失敗しました (${resp.status})`);
    }
    const buf = Buffer.from(await resp.arrayBuffer());

    // 3. Workbook読み込み
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);

    // 4. PriceState生成
    const newState = buildPriceStateFromWorkbook(wb);

    // 5. 調査日が同じなら更新不要
    if (current && current.lastSurveyDate === newState.lastSurveyDate) {
      return NextResponse.json({
        latest: true,
        state: current,
        message: 'データは最新です',
      });
    }

    // 6. KVに保存
    await saveState(newState);

    return NextResponse.json({
      latest: false,
      state: newState,
      message: '最新データを取得しました',
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { error: e.message ?? '更新に失敗しました' },
      { status: 500 }
    );
  }
}

