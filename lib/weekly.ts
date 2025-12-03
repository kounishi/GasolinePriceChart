// lib/weekly.ts

import ExcelJS from 'exceljs';
import type { PriceState, Section, PrefRow } from './types';

function normalizeName(v: any): string {
  if (v == null) return '';
  return String(v).replace(/\s|　/g, ''); // 半角・全角スペース除去
}

// 東日本・西日本に分けるための都道府県リスト（必要に応じて調整）
const EAST_PREFS = [
  '北海道',
  '青森',
  '岩手',
  '宮城',
  '秋田',
  '山形',
  '福島',
  '茨城',
  '栃木',
  '群馬',
  '埼玉',
  '千葉',
  '東京',
  '神奈川',
  '新潟',
  '富山',
  '石川',
  '福井',
  '山梨',
  '長野',
];

const WEST_PREFS = [
  '岐阜',
  '静岡',
  '愛知',
  '三重',
  '滋賀',
  '京都',
  '大阪',
  '兵庫',
  '奈良',
  '和歌山',
  '鳥取',
  '島根',
  '岡山',
  '広島',
  '山口',
  '徳島',
  '香川',
  '愛媛',
  '高知',
  '福岡',
  '佐賀',
  '長崎',
  '熊本',
  '大分',
  '宮崎',
  '鹿児島',
  '沖縄',
];

type Fuel = 'regular' | 'high' | 'diesel';

const FUEL_SHEET_NAME: Record<Fuel, string> = {
  regular: 'レギュラー',
  high: 'ハイオク',
  diesel: '軽油',
};

const FUEL_TITLE: Record<Fuel, string> = {
  regular: 'レギュラー',
  high: 'ハイオク',
  diesel: '軽油',
};

function getLast5RowNumbers(ws: ExcelJS.Worksheet, dateCol = 2): number[] {
  const nums: number[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const v = ws.getCell(r, dateCol).value;
    if (v) nums.push(r);
  }
  return nums.slice(-5); // 直近5行
}

// 1シートから Section(東日本/西日本) を2つ作る
function buildSectionsFromSheet(
  ws: ExcelJS.Worksheet,
  fuel: Fuel
): Section[] {
  const headerRowNumber = 1;
  const headerRow = ws.getRow(headerRowNumber);

  // "調査日" / "全国" / 各都道府県 の列番号を取得
  let dateCol = 0;
  let nationalCol = 0;
  const prefColMap = new Map<string, number>(); // 正規化名 -> 列

  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const name = normalizeName(cell.value);
    if (!name) return;
    if (name === '調査日') {
      dateCol = col;
    } else if (name === '全国') {
      nationalCol = col;
    } else {
      prefColMap.set(name, col);
    }
  });

  if (!dateCol || !nationalCol) {
    throw new Error(`${ws.name} シートで調査日/全国列が見つかりません`);
  }

  const last5Rows = getLast5RowNumbers(ws, dateCol);
  const sortedRows = [...last5Rows].sort((a, b) => a - b); // 古い順

  // 調査日
  const surveyDates = sortedRows.map((r) =>
    String(ws.getCell(r, dateCol).value ?? '')
  );

  // 全国
  const national = sortedRows.map((r) =>
    Number(ws.getCell(r, nationalCol).value ?? 0)
  );

  // 都道府県ごとのデータを PrefRow[] に
  function buildPrefRows(prefNames: string[]): PrefRow[] {
    const rows: PrefRow[] = [];
    for (const p of prefNames) {
      const norm = normalizeName(p);
      const col = prefColMap.get(norm);
      if (!col) continue; // 該当列がない場合はスキップ

      const prices = sortedRows.map((r) =>
        Number(ws.getCell(r, col).value ?? 0)
      );

      rows.push({ prefecture: p, prices });
    }
    return rows;
  }

  const eastRows = buildPrefRows(EAST_PREFS);
  const westRows = buildPrefRows(WEST_PREFS);

  const sections: Section[] = [];

  sections.push({
    id: `${fuel}-east`,
    title: `${FUEL_TITLE[fuel]}（東日本）`,
    fuel,
    region: 'east',
    surveyDates,
    national,
    rows: eastRows,
  });

  sections.push({
    id: `${fuel}-west`,
    title: `${FUEL_TITLE[fuel]}（西日本）`,
    fuel,
    region: 'west',
    surveyDates,
    national,
    rows: westRows,
  });

  return sections;
}

// Workbook全体 → PriceState
export function buildPriceStateFromWorkbook(wb: ExcelJS.Workbook): PriceState {
  const sections: Section[] = [];

  const regularSheet = wb.getWorksheet(FUEL_SHEET_NAME.regular);
  const highSheet = wb.getWorksheet(FUEL_SHEET_NAME.high);
  const dieselSheet = wb.getWorksheet(FUEL_SHEET_NAME.diesel);

  if (!regularSheet || !highSheet || !dieselSheet) {
    throw new Error('レギュラー/ハイオク/軽油シートのいずれかが見つかりません');
  }

  sections.push(...buildSectionsFromSheet(regularSheet, 'regular'));
  sections.push(...buildSectionsFromSheet(highSheet, 'high'));
  sections.push(...buildSectionsFromSheet(dieselSheet, 'diesel'));

  // lastSurveyDate は「どのセクションでも最後の調査日」でよい
  const lastSurveyDate = sections[0]?.surveyDates.slice(-1)[0] ?? '';

  return {
    lastSurveyDate,
    updatedAt: new Date().toISOString(),
    sections,
  };
}

