// lib/publishGap.ts
// 公表日が1週以上飛んでいる箇所を見つけ、祝日から理由を推定したメッセージを作る

import holiday_jp from '@holiday-jp/holiday_jp';

// 祝日データ（内閣府の一覧ベース、YYYY-MM-DD キー）。
// holiday_jp.between() は実行環境のタイムゾーンで日付を整形するため使わず、キーで直接引く。
const HOLIDAYS = holiday_jp.holidays as Record<string, { name: string }>;

const DAY_MS = 24 * 60 * 60 * 1000;

// "YYYY-MM-DD" → UTC 0時の時刻値（タイムゾーンに依存しない日付計算用）
function toUtcTime(date: string): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function toKey(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

// 例: 9/21
function toLabel(time: number): string {
  const d = new Date(time);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

// その日を含む週の月曜日
function mondayOf(time: number): number {
  const dow = new Date(time).getUTCDay(); // 0=日
  return time - ((dow + 6) % 7) * DAY_MS;
}

function holidayLabel(time: number): string {
  const name = HOLIDAYS[toKey(time)].name;
  // 祝日に挟まれた平日は「休日」と表記されている
  return `${toLabel(time)}（${name === '休日' ? '国民の休日' : name}）`;
}

// 最新公表日と公表予定日を順に並べた日付列（"YYYY-MM-DD..."）を受け取り、
// 公表の無い週ごとにメッセージを返す。飛んでいなければ空配列。
export function buildPublishGapNotes(publishDates: string[]): string[] {
  const notes: string[] = [];
  const times = publishDates.map(toUtcTime);

  for (let i = 1; i < times.length; i++) {
    const prevWeek = mondayOf(times[i - 1]);
    const nextWeek = mondayOf(times[i]);

    for (let week = prevWeek + 7 * DAY_MS; week < nextWeek; week += 7 * DAY_MS) {
      // 月曜調査・水曜公表なので、平日（月〜金）の祝日を理由として挙げる
      const holidays: number[] = [];
      for (let d = 0; d < 5; d++) {
        const time = week + d * DAY_MS;
        if (HOLIDAYS[toKey(time)]) holidays.push(time);
      }

      if (holidays.length === 0) {
        notes.push(
          `${toLabel(week)}〜${toLabel(week + 4 * DAY_MS)}の週は、調査・公表がありません`
        );
        continue;
      }

      const first = holidayLabel(holidays[0]);
      const range =
        holidays.length === 1 ? first : `${first}〜${holidayLabel(holidays[holidays.length - 1])}`;
      notes.push(`祝日週は調査・公表が休みのため、${range}の週は、調査・公表がありません`);
    }
  }

  return notes;
}
