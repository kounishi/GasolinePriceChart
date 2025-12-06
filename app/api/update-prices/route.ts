// app/api/update-prices/route.ts
// ブラウザからの「更新」ボタンクリック時に呼ばれるエンドポイント
// Redisからデータを読み込んで表示を更新するだけ（週次ファイルの取得やRedisへの保存は行わない）

import { NextRequest, NextResponse } from 'next/server';
import { loadState } from '@/lib/store';

export const runtime = 'nodejs';

export async function POST(_req: NextRequest) {
  try {
    // Redisから現在のデータを読み込む
    const state = await loadState();

    if (!state) {
      return NextResponse.json({
        latest: false,
        state: null,
        message: 'データがまだ更新されていません。Cronジョブまたはローカルスクリプトによる更新を待ってください。',
      });
    }

    // データが存在する場合は、そのまま返す
    return NextResponse.json({
      latest: true,
      state: state,
      message: '表示を更新しました',
    });
  } catch (e: any) {
    console.error(e);
    const errorMessage = e.message ?? 'データの読み込みに失敗しました';
    
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

