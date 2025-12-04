// app/api/cron/update-prices/route.ts
// Vercel Cron Jobs用のバックグラウンド処理エンドポイント

import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getWeeklyFileUrl } from '@/lib/enecho';
import { buildPriceStateFromWorkbook } from '@/lib/weekly';
import { loadState, saveState } from '@/lib/store';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5分（Cron Jobsは最大5分まで）

export async function GET(request: NextRequest) {
  // Vercel Cron Jobsからのリクエストか確認
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('Cronジョブ: データ更新を開始します');
    const current = await loadState();

    // 1. 週次ファイルURL取得
    const weeklyUrl = await getWeeklyFileUrl();

    // 2. Excel取得（タイムアウトを長めに設定）
    const maxRetries = 3;
    const timeoutMs = 120000; // 2分タイムアウト（Cron Jobsは5分まで可能）
    let resp: Response | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        console.log(`週次ファイル取得を開始します (試行 ${attempt}/${maxRetries})`);
        const startTime = Date.now();

        resp = await fetch(weeklyUrl, {
          cache: 'no-store',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const duration = Date.now() - startTime;
        console.log(`週次ファイル取得完了 (所要時間: ${duration}ms)`);

        break; // 成功したらループを抜ける
      } catch (error: any) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
          if (attempt < maxRetries) {
            console.warn(
              `週次ファイル取得がタイムアウトしました (試行 ${attempt}/${maxRetries})。リトライします...`
            );
            // リトライ前に待機
            await new Promise((resolve) => setTimeout(resolve, 5000));
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
      console.log('Cronジョブ: データは最新です');
      return NextResponse.json({
        success: true,
        latest: true,
        message: 'データは最新です',
      });
    }

    // 6. Redisに保存
    await saveState(newState);
    console.log('Cronジョブ: データ更新が完了しました');

    return NextResponse.json({
      success: true,
      latest: false,
      message: '最新データを取得しました',
      lastSurveyDate: newState.lastSurveyDate,
    });
  } catch (e: any) {
    console.error('Cronジョブ: エラーが発生しました', e);
    return NextResponse.json(
      { success: false, error: e.message ?? '更新に失敗しました' },
      { status: 500 }
    );
  }
}

