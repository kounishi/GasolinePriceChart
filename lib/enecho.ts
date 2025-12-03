// lib/enecho.ts

import * as cheerio from 'cheerio';

const RESULTS_URL =
  'https://www.enecho.meti.go.jp/statistics/petroleum_and_lpgas/pl007/results.html';

// HTML を読んで「週次ファイル」のリンクを探す
export async function getWeeklyFileUrl(): Promise<string> {
  const resp = await fetch(RESULTS_URL, { cache: 'no-store' });
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
}

