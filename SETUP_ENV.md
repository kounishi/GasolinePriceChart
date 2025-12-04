# 環境変数の設定方法

## 方法1: Vercel CLIを使用（推奨）

### 1. Vercel CLIのインストール

```bash
npm install -g vercel
```

### 2. Vercelにログイン

```bash
vercel login
```

### 3. プロジェクトをVercelにリンク（初回のみ）

```bash
vercel link
```

このコマンドを実行すると、以下の質問が表示されます：
- **Set up and deploy?** → `N` (No)
- **Which scope?** → あなたのアカウントを選択
- **Link to existing project?** → `N` (新規プロジェクトの場合) または `Y` (既存プロジェクトの場合)

### 4. 環境変数を取得

```bash
vercel env pull .env.local
```

これで、`.env.local` ファイルにVercel KVの環境変数が自動的に書き込まれます。

---

## 方法2: Vercel Dashboardから手動で取得

### 1. Vercel Dashboardにアクセス

https://vercel.com/dashboard にアクセスしてログインします。

### 2. プロジェクトを選択または作成

- 既存のプロジェクトがある場合：プロジェクトを選択
- 新規プロジェクトの場合：プロジェクトを作成

### 3. Vercel KVを有効化

1. プロジェクトの **Storage** タブを開く
2. **Create Database** → **KV** を選択
3. KVデータベースを作成
4. プロジェクトにリンク（**Add to Project**）

### 4. 環境変数を確認

1. プロジェクトの **Settings** タブを開く
2. **Environment Variables** を選択
3. 以下の環境変数が表示されます：
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`
   - `KV_REST_API_READ_ONLY_TOKEN`
   - `KV_URL`
   - `REDIS_URL`（Redisを使用する場合）

### 5. Cronジョブ用の環境変数を設定

Cronジョブによる自動更新を有効にするには、`CRON_SECRET`環境変数を設定する必要があります。

1. プロジェクトの **Settings** タブを開く
2. **Environment Variables** を選択
3. **Add New** をクリック
4. 以下の環境変数を追加：
   - **Key**: `CRON_SECRET`
   - **Value**: ランダムな文字列（例：`openssl rand -base64 32`で生成）
   - **Environment**: Production, Preview, Development すべてにチェック
5. **Save** をクリック

### 6. `.env.local` ファイルを作成

プロジェクトのルートディレクトリに `.env.local` ファイルを作成し、以下の形式で環境変数を記述します：

```env
KV_REST_API_URL=https://your-kv-instance.upstash.io
KV_REST_API_TOKEN=your-token-here
KV_REST_API_READ_ONLY_TOKEN=your-read-only-token-here
KV_URL=redis://default:your-password@your-kv-instance.upstash.io:6379
REDIS_URL=redis://default:your-password@your-redis-instance.upstash.io:6379
CRON_SECRET=your-random-secret-string
```

**注意**: 実際の値は、Vercel Dashboardに表示されている値をコピーしてください。

---

## 方法3: ローカル開発用の代替手段（Vercel KVなしでテスト）

Vercel KVがまだ設定されていない場合、一時的にモック実装を使用することもできます。

### モック実装の作成

`lib/store.mock.ts` を作成：

```typescript
import type { PriceState } from './types';

const KEY = 'gas_price_state';
let mockData: PriceState | null = null;

export async function loadState(): Promise<PriceState | null> {
  return mockData;
}

export async function saveState(state: PriceState): Promise<void> {
  mockData = state;
}
```

`lib/store.ts` を一時的に変更：

```typescript
// 開発環境のみモックを使用
const useMock = process.env.NODE_ENV === 'development' && !process.env.KV_REST_API_URL;

if (useMock) {
  const mock = require('./store.mock');
  module.exports = mock;
} else {
  // 通常の実装
  // ...
}
```

---

## 確認方法

環境変数が正しく設定されているか確認：

```bash
# Windows PowerShell
Get-Content .env.local

# または
cat .env.local
```

`.env.local` ファイルには以下の環境変数が含まれている必要があります：
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `KV_REST_API_READ_ONLY_TOKEN`
- `KV_URL`
- `REDIS_URL`（Redisを使用する場合）
- `CRON_SECRET`（Cronジョブを使用する場合）

---

## トラブルシューティング

### エラー: "KV client is not configured"

環境変数が正しく設定されていない可能性があります。`.env.local` ファイルが存在し、正しい値が設定されているか確認してください。

### エラー: "Unauthorized"

`KV_REST_API_TOKEN` が正しくない可能性があります。Vercel Dashboardから最新のトークンを取得してください。

### ローカルで動作しない

Next.jsの開発サーバーを再起動してください：

```bash
# サーバーを停止（Ctrl+C）
# 再度起動
npm run dev
```

