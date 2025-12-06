// scripts/update-prices.ts
// ローカルPCからスケジュール実行されるデータ更新スクリプト

// 環境変数を読み込む（.env.localファイルから）
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

// 環境変数の読み込みを確認
if (!process.env.REDIS_URL) {
  console.warn('警告: REDIS_URL環境変数が設定されていません。モック実装が使用されます。');
} else {
  console.log('✓ REDIS_URL環境変数が設定されています');
}

import { getWeeklyFileUrl } from '../lib/enecho';
import { buildPriceStateFromWorkbook } from '../lib/weekly';
import { loadState, saveState } from '../lib/store';
import ExcelJS from 'exceljs';

async function main() {
  try {
    console.log('='.repeat(60));
    console.log('データ更新を開始します...');
    console.log(`開始時刻: ${new Date().toLocaleString('ja-JP')}`);
    console.log('='.repeat(60));

    const current = await loadState();
    if (current) {
      console.log(`現在の最終調査日: ${current.lastSurveyDate}`);
    } else {
      console.log('現在のデータ: なし');
    }

    // 1. 週次ファイルURL取得
    console.log('\n[1/4] 週次ファイルURLを取得中...');
    const weeklyUrl = await getWeeklyFileUrl();
    console.log(`週次ファイルURL: ${weeklyUrl}`);

    // 2. Excel取得
    console.log('\n[2/4] 週次ファイルをダウンロード中...');
    const startTime = Date.now();
    const resp = await fetch(weeklyUrl, { cache: 'no-store' });
    
    if (!resp.ok) {
      throw new Error(`週次ファイル取得に失敗しました (${resp.status})`);
    }
    
    const buf = Buffer.from(await resp.arrayBuffer());
    const downloadDuration = Date.now() - startTime;
    console.log(`ダウンロード完了 (所要時間: ${downloadDuration}ms)`);

    // 3. Workbook読み込み
    console.log('\n[3/4] Excelファイルを解析中...');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    console.log('解析完了');

    // 4. PriceState生成
    console.log('\n[4/4] データを生成中...');
    const newState = buildPriceStateFromWorkbook(wb);
    console.log(`生成された最終調査日: ${newState.lastSurveyDate}`);

    // 5. 古い形式のデータを検出（セクション数が6個、またはIDに`-east`/`-west`が含まれる）
    const isOldFormat = current && (
      current.sections.length === 6 ||
      current.sections.some(s => s.id.includes('-east') || s.id.includes('-west'))
    );

    // 5-2. 既存データに北海道・沖縄のデータが含まれているかを確認
    const hasHokkaidoOkinawaData = current && (() => {
      // 北海道と沖縄のセクションを確認
      const hokkaidoSections = current.sections.filter(s => s.region === 'hokkaido');
      const okinawaSections = current.sections.filter(s => s.region === 'okinawa');
      
      // 各セクションにデータが含まれているか確認
      const hokkaidoHasData = hokkaidoSections.length > 0 && 
        hokkaidoSections.every(s => s.rows.length > 0 && s.rows.some(r => r.prefecture === '北海道' && r.prices.some(p => p > 0)));
      const okinawaHasData = okinawaSections.length > 0 && 
        okinawaSections.every(s => s.rows.length > 0 && s.rows.some(r => r.prefecture === '沖縄' && r.prices.some(p => p > 0)));
      
      return hokkaidoHasData && okinawaHasData;
    })();

    // 6. 調査日が同じで、かつ新しい形式で、かつ北海道・沖縄のデータが含まれている場合は更新不要
    if (current && current.lastSurveyDate === newState.lastSurveyDate && !isOldFormat && hasHokkaidoOkinawaData) {
      console.log('\n' + '='.repeat(60));
      console.log('✓ データは最新です。更新は不要です。');
      console.log('='.repeat(60));
      return;
    }

    // 6-2. 北海道・沖縄のデータが不足している場合は更新が必要
    if (current && !hasHokkaidoOkinawaData) {
      console.log('\n既存データに北海道・沖縄のデータが不足しています。更新します...');
    }

    // 7. Redisに保存（古い形式の場合は強制更新）
    if (isOldFormat) {
      console.log('\n古い形式のデータが検出されました。新しい形式に更新します...');
    }
    console.log('\nデータをRedisに保存中...');
    await saveState(newState);
    
    const totalDuration = Date.now() - startTime;
    console.log('\n' + '='.repeat(60));
    console.log('✓ データ更新が完了しました！');
    console.log(`最終調査日: ${newState.lastSurveyDate}`);
    console.log(`更新時刻: ${new Date().toLocaleString('ja-JP')}`);
    console.log(`総所要時間: ${totalDuration}ms`);
    console.log('='.repeat(60));
  } catch (error: any) {
    console.error('\n' + '='.repeat(60));
    console.error('✗ エラーが発生しました:');
    console.error(error.message);
    if (error.stack) {
      console.error('\nスタックトレース:');
      console.error(error.stack);
    }
    console.error('='.repeat(60));
    process.exit(1);
  }
}

main();

