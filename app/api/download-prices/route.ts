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
// テンプレートは「東日本」「西日本」の2セクション構造（3燃料 × 2地域 = 6セクション）
// 東日本：東北、関東、中部（北海道は除く）
// 西日本：近畿、中国、四国、九州、沖縄、北海道（沖縄はAA列、北海道はAB列）
const SECTION_LAYOUTS: Record<
  string,
  { sheet: string; headerRow: number; dataStartRow: number }
> = {
  // レギュラー
  'regular-east': { sheet: '比較表まとめ', headerRow: 1, dataStartRow: 2 },
  'regular-west': { sheet: '比較表まとめ', headerRow: 21, dataStartRow: 22 },
  // ハイオク
  'high-east': { sheet: '比較表まとめ', headerRow: 7, dataStartRow: 8 },
  'high-west': { sheet: '比較表まとめ', headerRow: 27, dataStartRow: 28 },
  // 軽油
  'diesel-east': { sheet: '比較表まとめ', headerRow: 13, dataStartRow: 14 },
  'diesel-west': { sheet: '比較表まとめ', headerRow: 33, dataStartRow: 34 },
};

// 地方を東日本/西日本に分類（テンプレート構造に合わせる）
// 東日本：東北、関東、中部（北海道は除く）
// 西日本：近畿、中国、四国、九州、沖縄、北海道
const EAST_REGIONS: Region[] = ['tohoku', 'kanto', 'chubu'];
const WEST_REGIONS: Region[] = ['kinki', 'chugoku', 'shikoku', 'kyushu', 'okinawa', 'hokkaido'];

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
  // ヘッダー行を検出（指定された行の前後を確認）
  let actualHeaderRow: ExcelJS.Row | null = null;
  let actualHeaderRowNum = 0;
  const debugInfo: string[] = [];
  
  // 指定された行から上方向に最大20行まで検索（範囲を拡大）
  for (let offset = 0; offset <= 20; offset++) {
    const testRowNum = headerRowNum - offset;
    if (testRowNum < 1) break;
    
    const testRow = sheet.getRow(testRowNum);
    let foundDate = false;
    let foundNational = false;
    const cellNames: string[] = [];
    
    // 行にセルが存在するか確認
    const hasCells = testRow.cellCount > 0;
    
    if (hasCells) {
      testRow.eachCell({ includeEmpty: false }, (cell, col) => {
        const name = normalizeName(cell.value);
        if (col <= 5) { // 最初の5列だけデバッグ情報に含める
          cellNames.push(`${col}:"${name}"`);
        }
        if (name === '調査日') foundDate = true;
        if (name === '全国') foundNational = true;
      });
    }
    
    // デバッグ情報は最初の5行と最後の5行のみ記録（ログを減らす）
    if (offset <= 5 || offset >= 15) {
      debugInfo.push(`行${testRowNum}: ${hasCells ? `[${cellNames.join(', ')}]` : '(空行)'}`);
    }
    
    if (foundDate && foundNational) {
      actualHeaderRow = testRow;
      actualHeaderRowNum = testRowNum;
      break;
    }
  }
  
  // 上方向で見つからない場合、下方向も検索（最大10行に拡大）
  if (!actualHeaderRow) {
    for (let offset = 1; offset <= 10; offset++) {
      const testRowNum = headerRowNum + offset;
      if (testRowNum > sheet.rowCount) break;
      
      const testRow = sheet.getRow(testRowNum);
      let foundDate = false;
      let foundNational = false;
      const cellNames: string[] = [];
      
      // 行にセルが存在するか確認
      const hasCells = testRow.cellCount > 0;
      
      if (hasCells) {
        testRow.eachCell({ includeEmpty: false }, (cell, col) => {
          const name = normalizeName(cell.value);
          if (col <= 5) {
            cellNames.push(`${col}:"${name}"`);
          }
          if (name === '調査日') foundDate = true;
          if (name === '全国') foundNational = true;
        });
      }
      
      debugInfo.push(`行${testRowNum}: ${hasCells ? `[${cellNames.join(', ')}]` : '(空行)'}`);
      
      if (foundDate && foundNational) {
        actualHeaderRow = testRow;
        actualHeaderRowNum = testRowNum;
        break;
      }
    }
  }
  
  if (!actualHeaderRow) {
    const searchRange = `行${Math.max(1, headerRowNum - 20)}～${Math.min(sheet.rowCount, headerRowNum + 10)}`;
    throw new Error(`テンプレ側で調査日/全国列が見つかりません。セクション: ${section.id}, シート: ${sheet.name}, 検索範囲: ${searchRange}\n検索結果:\n${debugInfo.join('\n')}`);
  }

  // テンプレ側ヘッダーの列マップ
  let dateCol = 0;
  let nationalCol = 0;
  const prefCols: { name: string; col: number }[] = [];

  const allHeaderCells: { col: number; raw: string; normalized: string }[] = [];
  
  // 全列を確認（最大200列まで、またはシートの列数）
  const sheetColumnCount = sheet.columnCount || 200;
  const maxCol = Math.max(200, sheetColumnCount);
  
  actualHeaderRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const rawValue = String(cell.value || '');
    const name = normalizeName(cell.value);
    allHeaderCells.push({ col, raw: rawValue, normalized: name });
    
    if (!name) return;
    
    // 1列目は燃料名（「レギュラー現金価格※」「ハイオク現金価格※」など）の可能性があるのでスキップ
    if (col === 1) return;
    
    if (name === '調査日') {
      dateCol = col;
    } else if (name === '全国') {
      nationalCol = col;
    } else {
      prefCols.push({ name, col });
    }
  });
  
  // データに北海道・沖縄が含まれているか確認
  const hasHokkaido = section.rows.some(r => normalizeName(r.prefecture).includes('北海道'));
  const hasOkinawa = section.rows.some(r => normalizeName(r.prefecture).includes('沖縄'));
  
  // 空のセルも含めて全列を確認（デバッグ用）
  if (hasHokkaido || hasOkinawa) {
    const allCellsIncludingEmpty: { col: number; raw: string; normalized: string }[] = [];
    console.log(`[${section.id}] 全列検索を開始 (maxCol=${maxCol}, sheet.columnCount=${sheet.columnCount}, actualHeaderRow.cellCount=${actualHeaderRow.cellCount})`);
    for (let col = 1; col <= maxCol; col++) {
      const cell = actualHeaderRow.getCell(col);
      const rawValue = String(cell.value || '');
      const name = normalizeName(cell.value);
      allCellsIncludingEmpty.push({ col, raw: rawValue, normalized: name });
    }
    const hokkaidoCells = allCellsIncludingEmpty.filter(c => c.normalized.includes('北海道'));
    const okinawaCells = allCellsIncludingEmpty.filter(c => c.normalized.includes('沖縄'));
    if (hokkaidoCells.length > 0) {
      console.log(`[${section.id}] 全列検索で見つかった北海道関連セル: [${hokkaidoCells.map(c => `${c.col}:"${c.raw}"->"${c.normalized}"`).join(', ')}]`);
    } else {
      console.log(`[${section.id}] 全列検索で北海道関連セルが見つかりませんでした (検索範囲: 列1～${maxCol})`);
    }
    if (okinawaCells.length > 0) {
      console.log(`[${section.id}] 全列検索で見つかった沖縄関連セル: [${okinawaCells.map(c => `${c.col}:"${c.raw}"->"${c.normalized}"`).join(', ')}]`);
    } else {
      console.log(`[${section.id}] 全列検索で沖縄関連セルが見つかりませんでした (検索範囲: 列1～${maxCol})`);
    }
  }
  
  // デバッグ: 北海道・沖縄のセクションでヘッダー行の全セルを確認
  if (hasHokkaido || hasOkinawa) {
    console.log(`[${section.id}] ヘッダー行${actualHeaderRowNum}の全セル (${allHeaderCells.length}列): [${allHeaderCells.map(c => `${c.col}:"${c.raw}"->"${c.normalized}"`).join(', ')}]`);
    // 北海道・沖縄関連の列を探す
    const hokkaidoCells = allHeaderCells.filter(c => c.normalized.includes('北海道'));
    const okinawaCells = allHeaderCells.filter(c => c.normalized.includes('沖縄'));
    if (hokkaidoCells.length > 0) {
      console.log(`[${section.id}] ヘッダー行内の北海道関連セル: [${hokkaidoCells.map(c => `${c.col}:"${c.raw}"->"${c.normalized}"`).join(', ')}]`);
    }
    if (okinawaCells.length > 0) {
      console.log(`[${section.id}] ヘッダー行内の沖縄関連セル: [${okinawaCells.map(c => `${c.col}:"${c.raw}"->"${c.normalized}"`).join(', ')}]`);
    }
  }

  if (!dateCol || !nationalCol) {
    throw new Error(`テンプレ側で調査日/全国列が見つかりません。セクション: ${section.id}, シート: ${sheet.name}, 検出されたヘッダー行: ${actualHeaderRowNum}`);
  }
  
  // デバッグ: 北海道・沖縄のセクションでテンプレート側の列名を確認
  if (hasHokkaido || hasOkinawa) {
    const hokkaidoCols = prefCols.filter(p => p.name.includes('北海道'));
    const okinawaCols = prefCols.filter(p => p.name.includes('沖縄'));
    console.log(`[${section.id}] テンプレート側の列名 - 北海道関連: [${hokkaidoCols.map(c => `${c.col}:"${c.name}"`).join(', ')}], 沖縄関連: [${okinawaCols.map(c => `${c.col}:"${c.name}"`).join(', ')}]`);
    console.log(`[${section.id}] データ側の都道府県: [${section.rows.map(r => r.prefecture).join(', ')}]`);
    // テンプレート側の全列名を確認（最初の10列まで）
    const allColNames = prefCols.slice(0, 10).map(c => `${c.col}:"${c.name}"`).join(', ');
    console.log(`[${section.id}] テンプレート側の全列名（最初の10列）: [${allColNames}]`);
    // テンプレート側の全列名を確認（すべて）
    const allColNamesFull = prefCols.map(c => `${c.col}:"${c.name}"`).join(', ');
    console.log(`[${section.id}] テンプレート側の全列名（すべて）: [${allColNamesFull}]`);
  }
  
  // 実際のヘッダー行が指定された行と異なる場合、dataStartRowも調整
  const rowOffset = actualHeaderRowNum - headerRowNum;
  const adjustedDataStartRow = dataStartRow + rowOffset;

  const count = section.surveyDates.length; // 通常5

  for (let i = 0; i < count; i++) {
    const rowIndex = adjustedDataStartRow + i;
    const row = sheet.getRow(rowIndex);

    // 調査日（yyyy/M/d 形式に整形）
    row.getCell(dateCol).value = formatSurveyDate(section.surveyDates[i]);

    // 全国
    const nat = section.national[i] ?? 0;
    row.getCell(nationalCol).value = nat;

    // 各都道府県
    for (const { name, col } of prefCols) {
      // Section.rows から同じ都道府県名を探す
      // テンプレート側の列名が「北海道局」「沖縄局」の場合も考慮
      let prefRow = section.rows.find(
        (r) => normalizeName(r.prefecture) === name
      );
      
      // マッチングが失敗した場合、北海道・沖縄の特殊処理を試す
      if (!prefRow) {
        // テンプレート側が「北海道局」「沖縄局」の場合、データ側の「北海道局」「沖縄局」とマッチ
        if (name === '北海道局' || name === '沖縄局') {
          prefRow = section.rows.find(
            (r) => normalizeName(r.prefecture) === name
          );
          if (prefRow) {
            console.log(`[${section.id}] テンプレート列名「${name}」→ データ「${normalizeName(prefRow.prefecture)}」でマッチング成功`);
          }
        }
        
        // テンプレート側が「北海道局」「沖縄局」の場合、データ側の「北海道」「沖縄」でも検索
        if (!prefRow && (name === '北海道局' || name === '沖縄局')) {
          const baseName = name.replace('局', '');
          prefRow = section.rows.find(
            (r) => normalizeName(r.prefecture) === baseName
          );
          if (prefRow) {
            console.log(`[${section.id}] テンプレート列名「${name}」→ データ「${baseName}」でマッチング成功`);
          }
        }
        
        // テンプレート側が「北海道」「沖縄」の場合、データ側の「北海道局」「沖縄局」で検索
        if (!prefRow && (name === '北海道' || name === '沖縄')) {
          const withKyoku = name + '局';
          prefRow = section.rows.find(
            (r) => normalizeName(r.prefecture) === withKyoku
          );
          if (prefRow) {
            console.log(`[${section.id}] テンプレート列名「${name}」→ データ「${withKyoku}」でマッチング成功`);
          }
        }
        
        // テンプレート側が「北海道」「沖縄」の場合、データ側の「北海道」「沖縄」でも検索（念のため）
        if (!prefRow && (name === '北海道' || name === '沖縄')) {
          prefRow = section.rows.find(
            (r) => normalizeName(r.prefecture) === name
          );
          if (prefRow) {
            console.log(`[${section.id}] テンプレート列名「${name}」→ データ「${name}」でマッチング成功`);
          }
        }
      }
      
      if (!prefRow) {
        // デバッグ: 北海道・沖縄関連の列でマッチング失敗した場合のみログ出力
        if (name.includes('北海道') || name.includes('沖縄')) {
          const availablePrefs = section.rows.map(r => normalizeName(r.prefecture)).join(', ');
          console.warn(`[${section.id}] テンプレート列名「${name}」にマッチするデータが見つかりません。利用可能な都道府県: [${availablePrefs}]`);
        }
        continue;
      }

      const v = prefRow.prices[i] ?? 0;
      const cell = row.getCell(col);
      cell.value = v;
      
      // デバッグ: 北海道・沖縄のデータがセットされた場合のみログ出力
      if (name.includes('北海道') || name.includes('沖縄')) {
        console.log(`[${section.id}] 行${rowIndex}, 列${col} (${name}) に価格 ${v} をセット`);
      }

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
  console.log('=== テンプレートへのデータ書き込みを開始 ===');
  
  // 燃料ごとに処理
  const fuels: Array<'regular' | 'high' | 'diesel'> = ['regular', 'high', 'diesel'];
  
  for (const fuel of fuels) {
    // 東日本と西日本に分けて処理
    for (const area of ['east', 'west'] as const) {
      const sectionId = `${fuel}-${area}`;
      const layout = SECTION_LAYOUTS[sectionId];
      if (!layout) {
        console.warn(`レイアウト定義が見つかりません: ${sectionId}`);
        continue;
      }

      const sheet = wb.getWorksheet(layout.sheet);
      if (!sheet) {
        console.warn(`シートが見つかりません: ${layout.sheet} (セクション: ${sectionId})`);
        continue;
      }

      // 該当する地方のセクションを集約
      const regions = area === 'east' ? EAST_REGIONS : WEST_REGIONS;
      const relevantSections = state.sections.filter(
        s => s.fuel === fuel && regions.includes(s.region)
      );

      if (relevantSections.length === 0) {
        console.warn(`データが見つかりません: ${sectionId}`);
        continue;
      }

      // 最初のセクションの調査日と全国データを使用（すべて同じはず）
      const firstSection = relevantSections[0];
      
      // すべての都道府県データを集約
      let allPrefRows = relevantSections.flatMap(s => s.rows);
      
      // 三重はデータ側では西日本（kinki地方）に分類されているが、
      // テンプレートでは東日本のセクションに配置されている
      if (area === 'east') {
        // 東日本セクションに三重を追加
        const kinkiSection = state.sections.find(
          s => s.fuel === fuel && s.region === 'kinki'
        );
        if (kinkiSection) {
          const mieRow = kinkiSection.rows.find(r => normalizeName(r.prefecture) === '三重');
          if (mieRow) {
            allPrefRows.push(mieRow);
            console.log(`[${sectionId}] 三重のデータを東日本セクションに追加しました`);
          }
        }
      } else {
        // 西日本セクションから三重を除外
        allPrefRows = allPrefRows.filter(r => normalizeName(r.prefecture) !== '三重');
        console.log(`[${sectionId}] 三重のデータを西日本セクションから除外しました`);
      }

      // 集約したセクションを作成
      const aggregatedSection: Section = {
        id: sectionId,
        title: `${fuel === 'regular' ? 'レギュラー' : fuel === 'high' ? 'ハイオク' : '軽油'}（${area === 'east' ? '東日本' : '西日本'}）`,
        fuel,
        region: area === 'east' ? 'hokkaido' : 'okinawa', // ダミー値（使用しない）
        surveyDates: firstSection.surveyDates,
        national: firstSection.national,
        rows: allPrefRows,
      };

      try {
        console.log(`[${sectionId}] セクション処理を開始 (シート: ${layout.sheet}, ヘッダー行: ${layout.headerRow}, データ開始行: ${layout.dataStartRow})`);
        fillSection(sheet, aggregatedSection, layout.headerRow, layout.dataStartRow);
        console.log(`[${sectionId}] セクション処理が完了しました`);
      } catch (error: any) {
        console.warn(`セクション ${sectionId} の処理をスキップしました: ${error.message}`);
        // エラーが発生しても他のセクションの処理は続行
      }
    }
  }
  
  console.log('=== テンプレートへのデータ書き込みが完了 ===');
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

