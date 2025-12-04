// app/api/update-prices/route.ts

import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getWeeklyFileUrl } from '@/lib/enecho';
import { buildPriceStateFromWorkbook } from '@/lib/weekly';
import { loadState, saveState } from '@/lib/store';

export const runtime = 'nodejs';

export async function POST(_req: NextRequest) {
  // 全体のタイムアウトを設定（Vercelの60秒制限より前にエラーレスポンスを返す）
  const overallTimeout = setTimeout(() => {
    // このタイムアウトは実際には処理を中断できないが、ログに記録する
    console.warn('リクエスト全体がタイムアウトに近づいています');
  }, 55000); // 55秒後に警告

  try {
    const current = await loadState();

    // 1. 週次ファイルURL取得
    const weeklyUrl = await getWeeklyFileUrl();

    // 2. Excel取得
    const maxRetries = 2; // リトライ回数を減らす
    const timeoutMs = 25000; // 25秒タイムアウト（Vercelの60秒制限内で余裕を持たせる）
    let resp: Response | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        resp = await fetch(weeklyUrl, {
          cache: 'no-store',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        break; // 成功したらループを抜ける
      } catch (error: any) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
          if (attempt < maxRetries) {
            console.warn(
              `週次ファイル取得がタイムアウトしました (試行 ${attempt}/${maxRetries})。リトライします...`
            );
            // リトライ前に少し待機
            await new Promise((resolve) => setTimeout(resolve, 2000));
            continue;
          }
          throw new Error('週次ファイル取得がタイムアウトしました（リトライ上限に達しました）');
        }
        throw error;
      }
    }

    if (!resp) {
      throw new Error('週次ファイル取得に失敗しました');
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
  } finally {
    clearTimeout(overallTimeout);
  }
}

