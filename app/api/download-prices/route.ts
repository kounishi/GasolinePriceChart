// app/api/download-prices/route.ts

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import path from 'path';
import ExcelJS from 'exceljs';
import { loadState } from '@/lib/store';
import type { PriceState, Section, Region } from '@/lib/types';

export const runtime = 'nodejs';

const TEMPLATE_PATH = path.join(
  process.cwd(),
  'templates',
  '251203_ガソリン価格比較表.xlsx'
);

// ★テンプレの各セクションの位置を定義
// 地方ごとのセクション（3燃料 × 9地方 = 27セクション）
// EXCELテンプレートの実際の構造に合わせて調整してください
const SECTION_LAYOUTS: Record<
  string,
  { sheet: string; headerRow: number; dataStartRow: number }
> = {
  // レギュラー
  'regular-hokkaido': { sheet: '比較表まとめ', headerRow: 1, dataStartRow: 2 },
  'regular-tohoku': { sheet: '比較表まとめ', headerRow: 8, dataStartRow: 9 },
  'regular-kanto': { sheet: '比較表まとめ', headerRow: 15, dataStartRow: 16 },
  'regular-chubu': { sheet: '比較表まとめ', headerRow: 22, dataStartRow: 23 },
  'regular-kinki': { sheet: '比較表まとめ', headerRow: 29, dataStartRow: 30 },
  'regular-chugoku': { sheet: '比較表まとめ', headerRow: 36, dataStartRow: 37 },
  'regular-shikoku': { sheet: '比較表まとめ', headerRow: 43, dataStartRow: 44 },
  'regular-kyushu': { sheet: '比較表まとめ', headerRow: 50, dataStartRow: 51 },
  'regular-okinawa': { sheet: '比較表まとめ', headerRow: 57, dataStartRow: 58 },
  // ハイオク
  'high-hokkaido': { sheet: '比較表まとめ', headerRow: 64, dataStartRow: 65 },
  'high-tohoku': { sheet: '比較表まとめ', headerRow: 71, dataStartRow: 72 },
  'high-kanto': { sheet: '比較表まとめ', headerRow: 78, dataStartRow: 79 },
  'high-chubu': { sheet: '比較表まとめ', headerRow: 85, dataStartRow: 86 },
  'high-kinki': { sheet: '比較表まとめ', headerRow: 92, dataStartRow: 93 },
  'high-chugoku': { sheet: '比較表まとめ', headerRow: 99, dataStartRow: 100 },
  'high-shikoku': { sheet: '比較表まとめ', headerRow: 106, dataStartRow: 107 },
  'high-kyushu': { sheet: '比較表まとめ', headerRow: 113, dataStartRow: 114 },
  'high-okinawa': { sheet: '比較表まとめ', headerRow: 120, dataStartRow: 121 },
  // 軽油
  'diesel-hokkaido': { sheet: '比較表まとめ', headerRow: 127, dataStartRow: 128 },
  'diesel-tohoku': { sheet: '比較表まとめ', headerRow: 134, dataStartRow: 135 },
  'diesel-kanto': { sheet: '比較表まとめ', headerRow: 141, dataStartRow: 142 },
  'diesel-chubu': { sheet: '比較表まとめ', headerRow: 148, dataStartRow: 149 },
  'diesel-kinki': { sheet: '比較表まとめ', headerRow: 155, dataStartRow: 156 },
  'diesel-chugoku': { sheet: '比較表まとめ', headerRow: 162, dataStartRow: 163 },
  'diesel-shikoku': { sheet: '比較表まとめ', headerRow: 169, dataStartRow: 170 },
  'diesel-kyushu': { sheet: '比較表まとめ', headerRow: 176, dataStartRow: 177 },
  'diesel-okinawa': { sheet: '比較表まとめ', headerRow: 183, dataStartRow: 184 },
};

function normalizeName(v: any): string {
  if (v == null) return '';
  return String(v).replace(/\s|　/g, '');
}

// 調査日を yyyy/M/d 形式に整形（例: 2025/3/3）
function formatSurveyDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) {
    // パースできない場合は元の文字列をそのまま返す
    return dateStr;
  }
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}/${m}/${day}`;
}

function fillSection(
  sheet: ExcelJS.Worksheet,
  section: Section,
  headerRowNum: number,
  dataStartRow: number
) {
  const headerRow = sheet.getRow(headerRowNum);

  // テンプレ側ヘッダーの列マップ
  let dateCol = 0;
  let nationalCol = 0;
  const prefCols: { name: string; col: number }[] = [];

  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const name = normalizeName(cell.value);
    if (!name) return;
    if (name === '調査日') {
      dateCol = col;
    } else if (name === '全国') {
      nationalCol = col;
    } else {
      prefCols.push({ name, col });
    }
  });

  if (!dateCol || !nationalCol) {
    throw new Error('テンプレ側で調査日/全国列が見つかりません');
  }

  const count = section.surveyDates.length; // 通常5

  for (let i = 0; i < count; i++) {
    const rowIndex = dataStartRow + i;
    const row = sheet.getRow(rowIndex);

    // 調査日（yyyy/M/d 形式に整形）
    row.getCell(dateCol).value = formatSurveyDate(section.surveyDates[i]);

    // 全国
    const nat = section.national[i] ?? 0;
    row.getCell(nationalCol).value = nat;

    // 各都道府県
    for (const { name, col } of prefCols) {
      // Section.rows から同じ都道府県名を探す
      const prefRow = section.rows.find(
        (r) => normalizeName(r.prefecture) === name
      );
      if (!prefRow) continue;

      const v = prefRow.prices[i] ?? 0;
      const cell = row.getCell(col);
      cell.value = v;

      // ★ 全国より高ければ赤塗りする処理は、Excel側の条件付き書式で行うため無効化
      /*
      // 全国より高ければ赤塗り
      if (!isNaN(v) && v > nat) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFF0000' },
        };
      } else {
        cell.fill = undefined as any;
      }
      */
    }

    row.commit();
  }
}

function fillTemplateFromState(
  wb: ExcelJS.Workbook,
  state: PriceState
): void {
  for (const section of state.sections) {
    const layout = SECTION_LAYOUTS[section.id];
    if (!layout) continue; // 想定外のidはスキップ

    const sheet = wb.getWorksheet(layout.sheet);
    if (!sheet) continue;

    fillSection(sheet, section, layout.headerRow, layout.dataStartRow);
  }
}

export async function GET(_req: NextRequest) {
  try {
    const state = await loadState();
    if (!state) {
      return NextResponse.json(
        { error: 'まだデータが更新されていません' },
        { status: 400 }
      );
    }

    const tmplBuf = await fs.readFile(TEMPLATE_PATH);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tmplBuf as any);

    fillTemplateFromState(wb, state);

    const outBuf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const filename = encodeURIComponent('ガソリン価格比較表.xlsx');

    return new NextResponse(Buffer.from(outBuf), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { error: e.message ?? 'ダウンロードに失敗しました' },
      { status: 500 }
    );
  }
}

