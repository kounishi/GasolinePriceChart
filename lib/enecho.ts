// lib/enecho.ts

import * as cheerio from 'cheerio';

const RESULTS_URL =
  'https://www.enecho.meti.go.jp/statistics/petroleum_and_lpgas/pl007/results.html';

// HTML を読んで「週次ファイル」のリンクを探す
export async function getWeeklyFileUrl(): Promise<string> {
  const maxRetries = 1; // リトライ回数を1回に減らし、1回の試行時間を長くする
  const timeoutMs = 55000; // 55秒タイムアウト（Vercelの60秒制限内で最大限に）

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      console.log(`results.html取得を開始します (試行 ${attempt}/${maxRetries})`);
      const startTime = Date.now();
      
      const resp = await fetch(RESULTS_URL, {
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
      const duration = Date.now() - startTime;
      console.log(`results.html取得完了 (所要時間: ${duration}ms)`);
      
      if (!resp.ok) {
        throw new Error(`results.html取得に失敗しました (${resp.status})`);
      }

      const html = await resp.text();
      const $ = cheerio.load(html);

      const link = $('a')
        .filter((_, el) => $(el).text().includes('週次ファイル'))
        .first();

      const href = link.attr('href');
      if (!href) {
        throw new Error('「週次ファイル」のリンクが見つかりませんでした');
      }

      return new URL(href, RESULTS_URL).toString();
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        if (attempt < maxRetries) {
          console.warn(
            `results.html取得がタイムアウトしました (試行 ${attempt}/${maxRetries})。リトライします...`
          );
          // リトライ前に待機（サイトへの負荷を減らす）
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }
        throw new Error('results.html取得がタイムアウトしました（リトライ上限に達しました）');
      }
      
      // タイムアウト以外のエラーは即座にスロー
      throw error;
    }
  }

  throw new Error('results.html取得に失敗しました');
}

