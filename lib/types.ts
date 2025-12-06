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

export type PriceState = {
  lastSurveyDate: string; // 直近の調査日（文字列）
  updatedAt: string;      // 更新日時 ISO
  sections: Section[];    // レギュラー/ハイオク/軽油 × 9地方 = 27セクション
};

