# ガソリン価格比較アプリ仕様書

## 🔧 使用技術
- **Next.js (App Router)**
- **Vercel ホススティング**
- **Vercel KV** ← 最新データ保存
- **ExcelJS** ← 週次ExcelとテンプレートExcelの読み取り・加工
- **Cheerio** ← 資源エネルギー庁サイトから「週次ファイル」リンク抽出
- 言語: **TypeScript / JavaScript**

---

## 🎯 アプリ概要

資源エネルギー庁が公開しているガソリン価格週次データ（Excel）を取得し、
テンプレート Excel（`251203_ガソリン価格比較表.xlsx`）に転記して、**全国価格より高い都道府県の価格セルを赤色で強調**する Web アプリ。

- フロントページでは、テンプレと同じ構造の表を HTML でも表示
- 「更新」ボタンを押したときだけ最新週次データを取得・解析
- すでに最新データが反映済みであれば更新をスキップし「データは最新です」と表示
- 「価格表ダウンロード」ボタンで、テンプレートに反映済みの比較表 Excel をダウンロード

---

## 🧠 全体の仕組み

### 1️⃣ 初期表示（ページロード時）

`GET /api/prices`

- Vercel KV に保存されている前回の結果（PriceState）を取得
- 結果があれば、その内容をフロントで表として表示
- この段階では **資源エネルギー庁のサイトや週次Excelにはアクセスしない**

### 2️⃣ 更新ボタン  
「更新（資源エネルギー庁データの読込）」押下時

`POST /api/update-prices`

処理内容:

1. 資源エネルギー庁の `results.html` を取得  
   `https://www.enecho.meti.go.jp/statistics/petroleum_and_lpgas/pl007/results.html`
2. HTML から「週次ファイル」というリンクテキストを含む `<a>` を探し、Excel の URL を取得
3. 週次 Excel（例: `251127s5.xlsx`）をダウンロード
4. ExcelJS で Workbook として読み込み
5. 各シート（レギュラー / ハイオク / 軽油）について：
   - B列「調査日」から全行を取得し、末尾から **直近5回** の行番号を取得
   - 1行目ヘッダーから「調査日」「全国」および各都道府県列を特定
   - 東日本・西日本の都道府県リストに従って Section を構築
6. 全シートから構築した Section をまとめて **PriceState** を生成
7. 既存の `PriceState.lastSurveyDate` と、新しく取得した `lastSurveyDate` を比較  
   - 同じ → `latest: true` としてレスポンスし、KVは更新しない（更新スキップ）  
   - 違う → KV に新しい PriceState を保存し、`latest: false` を返す
8. フロント側は返ってきた `state` で表を再描画する

### 3️⃣ 価格表ダウンロードボタン

`GET /api/download-prices`

処理内容:

1. Vercel KV から最新の PriceState を取得
2. テンプレート Excel `251203_ガソリン価格比較表.xlsx` を読み込み
3. PriceState.sections（レギュラー/ハイオク/軽油 × 東日本/西日本）の各セクションについて：
   - 調査日5回分を所定の行に書き込み
   - 全国価格を所定列に書き込み
   - 都道府県ごとの価格を所定列に書き込み
   - 各行で、「全国」列の値より高い価格セルを赤色で塗りつぶし
4. 完成したテンプレートを `.xlsx` としてバイナリレスポンス（ダウンロード）

---

## 📁 データ構造（PriceState JSON）

`lib/types.ts` で定義。

```ts
// 都道府県1行分
export type PrefRow = {
  prefecture: string; // 都道府県名
  prices: number[];   // 調査日ごとの価格（古い順に5件）
};

// 1セクション（例: レギュラー東日本）
export type Section = {
  id: string;             // 例: "regular-east"
  title: string;          // 例: "レギュラー（東日本）"
  fuel: 'regular' | 'high' | 'diesel';
  region: 'east' | 'west';
  surveyDates: string[];  // 調査日（古い順に5件）
  national: number[];     // 全国価格（5件）
  rows: PrefRow[];        // 各都道府県
};

// KV に保存する全体構造
export type PriceState = {
  lastSurveyDate: string; // 直近の調査日（文字列）
  updatedAt: string;      // 更新日時（ISO文字列）
  sections: Section[];    // 6セクション
};
```

---

## 💾 ストレージ（Vercel KV）

### 保存と取得

`lib/store.ts`

```ts
import { kv } from '@vercel/kv';
import type { PriceState } from './types';

const KEY = 'gas_price_state';

export async function loadState(): Promise<PriceState | null> {
  const state = await kv.get<PriceState>(KEY);
  return state ?? null;
}

export async function saveState(state: PriceState): Promise<void> {
  await kv.set(KEY, state);
}
```

- KV は JSON をそのまま保存可能
- 直近 5 回 × 3燃料 × 都道府県分だけなのでデータサイズは数 KB 程度
- Vercel の無料枠で十分運用可能

### 更新判定ロジック

```ts
if (current && current.lastSurveyDate === newState.lastSurveyDate) {
  // すでに最新 → 更新不要
}
```

---

## 📌 画面仕様（フロント側）

### ボタン

| 要素 | ラベル | 動作 |
|------|--------|------|
| ボタン1 | 更新（資源エネルギー庁データの読込） | `/api/update-prices` を POST、最新データ取得とKV更新 |
| ボタン2 | 価格表ダウンロード | `/api/download-prices` を GET、Excel ダウンロード |

### メッセージ表示

- 更新後レスポンスの `latest` によりメッセージを出し分ける:
  - `latest: true` → 「データは最新です」
  - `latest: false` → 「最新データを取得しました」
- エラー時 → 「更新に失敗しました」など

### 表の構造

- セクションごとに1つの表（合計6表）
  - レギュラー（東日本 / 西日本）
  - ハイオク（東日本 / 西日本）
  - 軽油（東日本 / 西日本）
- 各表の列：  
  `調査日 / 全国 / 都道府県1 / 都道府県2 / ...`
- 各表の行：  
  `直近5回の調査日`（古い順）
- 各セル：
  - 全国より高い場合、背景を薄い赤色 (`bg-red-200` など) に

---

## 🧱 プロジェクト構成（推奨）

Next.js App Router + Vercel KV 前提。

```text
project-root/
├─ app/
│  ├─ api/
│  │  ├─ prices/
│  │  │  └─ route.ts              # KV から PriceState を返す（初期表示用）
│  │  ├─ update-prices/
│  │  │  └─ route.ts              # 週次Excelから最新データを取得・KV更新
│  │  └─ download-prices/
│  │     └─ route.ts              # KV + テンプレからExcelを生成してダウンロード
│  └─ page.tsx                    # フロントUI（ボタン + 表表示）
├─ lib/
│  ├─ types.ts                    # PrefRow / Section / PriceState 型定義
│  ├─ store.ts                    # Vercel KV ラッパー (loadState / saveState)
│  ├─ enecho.ts                   # 資源エネルギー庁の results.html から週次ファイルURL抽出
│  └─ weekly.ts                   # 週次Excelから PriceState を生成するロジック
├─ templates/
│  └─ 251203_ガソリン価格比較表.xlsx   # A3用テンプレートExcel
├─ package.json
└─ その他 Next.js 設定ファイル（tsconfig.json など）
```

### 各ファイルの役割

#### `app/api/prices/route.ts`
- `GET /api/prices`
- Vercel KV から `PriceState` を取得して返す
- ページ初期表示やリロード時に使用

#### `app/api/update-prices/route.ts`
- `POST /api/update-prices`
- `lib/enecho.ts` で週次ファイルの URL を取得
- ExcelJS で週次Excelを読み込み、`lib/weekly.ts` の `buildPriceStateFromWorkbook()` から `PriceState` を生成
- 既存 `PriceState` と `lastSurveyDate` を比較し、必要なときのみ KV を更新

#### `app/api/download-prices/route.ts`
- `GET /api/download-prices`
- KV から `PriceState` を取得
- `templates/251203_ガソリン価格比較表.xlsx` を読み込み
- セクションごとに所定セルへ書き込み + 全国より高いセルを赤塗り
- 加工済みExcelをレスポンス

#### `app/page.tsx`
- フロントのトップページ
- 初期表示時に `/api/prices` を `fetch` して `state` を読み込み
- 「更新」ボタン → `/api/update-prices` を POST
- 「価格表ダウンロード」ボタン → `/api/download-prices` にブラウザ遷移（ダウンロード）
- `PriceState.sections` を元にテンプレと同じ構造の表を描画

#### `lib/types.ts`
- PrefRow / Section / PriceState 型定義
- API 間のやり取りと KV の JSON 構造を固定する

#### `lib/store.ts`
- Vercel KV ラッパー
- `loadState()` / `saveState()` の2関数を提供

#### `lib/enecho.ts`
- 資源エネルギー庁 `results.html` を取得
- `cheerio` で `<a>` 要素を走査し、「週次ファイル」というテキストを持つリンクの `href` を取得
- 絶対URLに変換して返す

#### `lib/weekly.ts`
- ExcelJS を使って週次Excelの各シートを解析
- ヘッダー行から「調査日」「全国」「都道府県列」を自動判別
- B列（調査日）から直近5行を抽出
- 東日本・西日本の都道府県リストに従って `Section` を構築
- 全シートから `PriceState` を生成

#### `templates/251203_ガソリン価格比較表.xlsx`
- A3 用に調整された印刷テンプレート
- `比較表まとめ` シートで、東日本/西日本×レギュラー/ハイオク/軽油 の6セクションを配置
- 行・列の位置は `SECTION_LAYOUTS` で指定

---

## 📦 必要なパッケージ

```bash
npm install @vercel/kv exceljs cheerio
```

### Next.js / TypeScript 前提

- `next`, `react`, `react-dom`, `typescript` などはプロジェクトに合わせてインストール

---

## 🔐 環境変数（Vercel KV）

Vercel側で KV を有効にすると、自動的に以下の環境変数が設定される（通常は手動設定不要）。

例：

```env
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
KV_REST_API_READ_ONLY_TOKEN=...
KV_URL=...
```

アプリ側では特に環境変数を直接読む必要はなく、`@vercel/kv` の `kv` クライアントをそのまま使えばよい。

---

## 🚀 導入手順

1. **Vercel プロジェクト作成**
   - Next.js プロジェクトを Vercel に接続

2. **Vercel KV を有効化**
   - Vercel Dashboard で Storage → KV を追加
   - プロジェクトに KV をリンク（`Add to Project`）

3. **依存パッケージインストール**
   ```bash
   npm install @vercel/kv exceljs cheerio
   ```

4. **ディレクトリ構成を作成**
   - `app/api/...`、`lib/...`、`templates/...` を上記構成で配置
   - テンプレ Excel を `templates/251203_ガソリン価格比較表.xlsx` として追加

5. **デプロイ**
   - GitHub に push / Vercel 上でデプロイ
   - 初回は「更新」ボタンを押して初回の週次データを取得 → KV に保存

6. **動作確認**
   - ページ表示 → 表が出ない状態（「まだ更新されていません」メッセージ）を確認
   - 「更新」ボタン → 表が出ることを確認
   - 再度「更新」ボタン → 「データは最新です」と表示されることを確認
   - 「価格表ダウンロード」ボタン → Excel がダウンロードされ、赤塗りが反映されていることを確認

---

## 🔍 テンプレート調整が必要な箇所

### 1. セクション位置（行番号・シート名）

`app/api/download-prices/route.ts` の `SECTION_LAYOUTS` で指定：

```ts
const SECTION_LAYOUTS = {
  'regular-east': { sheet: '比較表まとめ', headerRow: 1, dataStartRow: 2 },
  'high-east':    { sheet: '比較表まとめ', headerRow: 7, dataStartRow: 8 },
  'diesel-east':  { sheet: '比較表まとめ', headerRow: 13, dataStartRow: 14 },
  'regular-west': { sheet: '比較表まとめ', headerRow: 21, dataStartRow: 22 },
  'high-west':    { sheet: '比較表まとめ', headerRow: 27, dataStartRow: 28 },
  'diesel-west':  { sheet: '比較表まとめ', headerRow: 33, dataStartRow: 34 },
};
```

テンプレ Excel の「比較表まとめ」シート上の実際の位置に合わせて、`headerRow` と `dataStartRow` を調整する。

### 2. 東日本 / 西日本の都道府県リスト

`lib/weekly.ts` 内の `EAST_PREFS` / `WEST_PREFS`：

```ts
const EAST_PREFS = [ '北海道', '青森', '岩手', ... ];
const WEST_PREFS = [ '岐阜', '静岡', '愛知', ... ];
```

テンプレ側と同じ並びになるように調整することを推奨。

### 3. 週次Excelの列名

- 週次Excelの1行目ヘッダは「全  国」「青  森」のようにスペースが入っている場合がある
- `normalizeName()` で半角・全角スペースを削除して比較しているので、基本はそのままで問題ない
- もし見つからない列がある場合は、Excelのヘッダ文字列と `normalizeName` の処理を確認

---

## 🆗 このアプリでできること（最終まとめ）

- ✅ 最新の週次ガソリン価格データを、ボタン1つで取得
- ✅ 直近5回分の調査日・全国・都道府県データを東日本/西日本別に集計
- ✅ 全国より高い都道府県を Excel と画面上で赤色ハイライト
- ✅ 一度取得したデータは Vercel KV に保存されるため、ページ表示時は高速
- ✅ すでに最新データが反映されている場合は更新処理をスキップして「データは最新です」と表示
- ✅ Vercel の無料枠の範囲内で運用可能

---

👑 追加したいアイデア（将来拡張）
- 調査日をクリックすると、その日の詳細データを別ページやモーダルで表示
- 更新履歴（どの調査日をいつ取得したか）を別KVキーや外部DBに保存
- 自動更新用の Vercel Cron Job を設定し、毎週自動で最新データを反映
- 各種燃料ごとにタブ切り替え UI を用意し、見やすさを向上
