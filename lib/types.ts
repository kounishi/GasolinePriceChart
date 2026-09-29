// lib/types.ts

export type PrefRow = {
  prefecture: string;     // 都道府県名
  prices: number[];       // 調査日ごとの価格（古い順に5件）
};

export type Region = 'hokkaido' | 'tohoku' | 'kanto' | 'chubu' | 'kinki' | 'chugoku' | 'shikoku' | 'kyushu' | 'okinawa';

export type Section = {
  id: string;             // 例: "regular-hokkaido"
  title: string;          // 例: "レギュラー（北海道）"
  fuel: 'regular' | 'high' | 'diesel';
  region: Region;
  surveyDates: string[];  // 調査日（古い順に5件）
  national: number[];     // 全国価格（5件）
  rows: PrefRow[];        // 各都道府県
};

export type PublishSchedule = {
  date: string;           // 公表予定日時 ISO（JST, 例: "2026-09-30T14:00:00+09:00"）
  label: string;          // サイト表記（例: "9月30日（水）14：00"）
};

// 更新処理の実行時点で results.html から読み取ったサイトの状況
export type SiteStatus = {
  checkedAt: string;                  // サイトを確認した日時 ISO
  latestPublishDate: string | null;   // 「調査結果」の最新公表日（例: "2026-09-16"）
  latestPublishLabel: string | null;  // サイト表記（例: "9月16日（水）"）
  schedule: PublishSchedule[];        // 「公表予定日」（サイト掲載順）
  scheduleNote: string | null;        // 例: "※原則、毎週月曜日調査、水曜日公表"
  publishGapNotes?: string[];         // 公表が1週飛んでいる理由（祝日から推定）。飛んでいなければ空
};

export type PriceState = {
  lastSurveyDate: string; // 直近の調査日（文字列）
  updatedAt: string;      // 更新日時 ISO
  sections: Section[];    // レギュラー/ハイオク/軽油 × 9地方 = 27セクション
  sourcePublishDate?: string | null; // 適用済みデータの公表日（週次ファイル名 YYMMDDs5.xlsx から。例: "2026-09-16"）
  siteStatus?: SiteStatus;           // 直近の更新処理で確認したサイトの状況
};

