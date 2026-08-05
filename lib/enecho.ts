// lib/enecho.ts

import * as cheerio from 'cheerio';

const RESULTS_URL =
  'https://www.enecho.meti.go.jp/statistics/petroleum_and_lpgas/pl007/results.html';

// 資源エネルギー庁サイトは 2026-07-01 から CloudFront + AWS WAF 配下にあり、
// ブラウザ以外の User-Agent を 403 でブロックする。
// Node の fetch は User-Agent: node を送るため、明示的に付与しないと必ず失敗する。
// enecho への fetch は results.html と週次xlsx の計3か所にあり、すべてこの定数を使うこと。
export const ENECHO_FETCH_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

// WAF のチャレンジ応答は 202 + x-amzn-waf-action ヘッダー・本文空で返る。
// 202 は resp.ok === true なので、ここで明示的に弾かないと
// 空のHTMLを解析して「「週次ファイル」のリンクが見つかりませんでした」という
// 無関係に見えるエラーに化ける。
export function assertNotWafChallenged(resp: Response, label: string): void {
  const action = resp.headers.get('x-amzn-waf-action');
  if (action) {
    throw new Error(
      `${label}がWAFのチャレンジを受けました (status=${resp.status}, x-amzn-waf-action=${action})。` +
        `短時間に多数アクセスすると発生します。数分待ってから再実行してください。`
    );
  }
}

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
        headers: ENECHO_FETCH_HEADERS,
      });
      clearTimeout(timeoutId);

      const duration = Date.now() - startTime;
      console.log(`results.html取得完了 (所要時間: ${duration}ms)`);

      assertNotWafChallenged(resp, 'results.html取得');

      if (!resp.ok) {
        throw new Error(
          `results.html取得に失敗しました (${resp.status})。` +
            `403 の場合は資源エネルギー庁サイトのWAFにブロックされている可能性があります（User-Agent 制限）`
        );
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

