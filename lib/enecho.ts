// lib/enecho.ts

import * as cheerio from 'cheerio';

const RESULTS_URL =
  'https://www.enecho.meti.go.jp/statistics/petroleum_and_lpgas/pl007/results.html';

// HTML を読んで「週次ファイル」のリンクを探す
export async function getWeeklyFileUrl(): Promise<string> {
  const maxRetries = 2; // リトライ回数を減らす
  const timeoutMs = 25000; // 25秒タイムアウト（Vercelの60秒制限内で余裕を持たせる）

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(RESULTS_URL, {
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
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
          // リトライ前に少し待機
          await new Promise((resolve) => setTimeout(resolve, 2000));
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

