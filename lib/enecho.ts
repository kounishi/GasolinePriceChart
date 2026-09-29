// lib/enecho.ts

import * as cheerio from 'cheerio';
import type { PublishSchedule, SiteStatus } from './types';
import { buildPublishGapNotes } from './publishGap';

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

// 全角数字・全角コロンを半角に揃える（サイト表記は「14：00」「１０月」などが混在しうる）
function toHalfWidth(text: string): string {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ':');
}

// 「M月D日」には年が無いので、基準日時に最も近い年を採用する（年末年始をまたぐ場合に対応）
function inferYear(month: number, day: number, reference: Date): number {
  // 実行環境のタイムゾーン（ローカルPCはJST、VercelはUTC）に依存しないよう JST で年を取る
  const refYear = new Date(reference.getTime() + 9 * 60 * 60 * 1000).getUTCFullYear();
  let best = refYear;
  let bestDiff = Infinity;
  for (const y of [refYear - 1, refYear, refYear + 1]) {
    const diff = Math.abs(Date.UTC(y, month - 1, day) - reference.getTime());
    if (diff < bestDiff) {
      best = y;
      bestDiff = diff;
    }
  }
  return best;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

// 「9月16日」→ "2026-09-16"
function parseMonthDay(text: string, reference: Date): string | null {
  const m = toHalfWidth(text).match(/(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = inferYear(month, day, reference);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

// 週次ファイル名 YYMMDDs5.xlsx から公表日を得る（例: 260916s5.xlsx → "2026-09-16"）
export function publishDateFromWeeklyUrl(url: string): string | null {
  const m = url.match(/\/(\d{2})(\d{2})(\d{2})s\d*\.xlsx$/i);
  if (!m) return null;
  return `20${m[1]}-${m[2]}-${m[3]}`;
}

// results.html の「調査結果」「公表予定日」を読み取る。
// 表示用の補助情報なので、読み取れなくても例外にはせず null / 空で返す。
export function parseSiteStatus(html: string, checkedAt: Date): SiteStatus {
  const $ = cheerio.load(html);

  // 「調査結果」: 「9月16日（水）結果詳細版（EXCEL形式）」のリンク
  const detailText = $('a')
    .filter((_, el) => $(el).text().includes('結果詳細版'))
    .first()
    .text();
  const labelMatch = toHalfWidth(detailText).match(/\d{1,2}月\d{1,2}日（.）/);
  const latestPublishLabel = labelMatch ? labelMatch[0] : null;
  const latestPublishDate = parseMonthDay(detailText, checkedAt);

  // 「公表予定日」: 最初の見出し（1．給油所小売価格調査）の直後の <p> を1行ずつ読む
  const schedule: PublishSchedule[] = [];
  let scheduleNote: string | null = null;
  const scheduleP = $('h3')
    .filter((_, el) => $(el).text().trim() === '公表予定日')
    .first()
    .next('p');
  const lines = scheduleP
    .text()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  for (const line of lines) {
    if (line.startsWith('※')) {
      scheduleNote = line;
      continue;
    }
    const date = parseMonthDay(line, checkedAt);
    if (!date) continue;
    const t = toHalfWidth(line).match(/(\d{1,2}):(\d{2})/);
    const time = t ? `${pad2(Number(t[1]))}:${t[2]}` : '00:00';
    schedule.push({ date: `${date}T${time}:00+09:00`, label: line });
  }

  if (!latestPublishDate) {
    console.warn('results.html: 「結果詳細版」のリンクから公表日を読み取れませんでした');
  }
  if (schedule.length === 0) {
    console.warn('results.html: 「公表予定日」を読み取れませんでした');
  }

  return {
    checkedAt: checkedAt.toISOString(),
    latestPublishDate,
    latestPublishLabel,
    schedule,
    scheduleNote,
    // 最新公表日 → 公表予定日の順に並べ、1週以上空いている箇所を調べる
    publishGapNotes: buildPublishGapNotes([
      ...(latestPublishDate ? [latestPublishDate] : []),
      ...schedule.map((s) => s.date),
    ]),
  };
}

// HTML を読んで「週次ファイル」のリンクとサイトの公表状況を取得する
export async function getResultsPageInfo(): Promise<{
  weeklyUrl: string;
  siteStatus: SiteStatus;
}> {
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

      return {
        weeklyUrl: new URL(href, RESULTS_URL).toString(),
        siteStatus: parseSiteStatus(html, new Date()),
      };
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

