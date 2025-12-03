# ガソリン価格比較アプリ

資源エネルギー庁が公開しているガソリン価格週次データを取得し、比較表示するWebアプリケーションです。

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

Vercel KVを使用するため、環境変数を設定する必要があります。

#### ローカル開発時

`.env.local` ファイルを作成し、以下の環境変数を設定してください：

```env
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
KV_REST_API_READ_ONLY_TOKEN=...
KV_URL=...
```

環境変数は、Vercel Dashboard のプロジェクト設定から取得するか、Vercel CLI を使用して取得できます：

```bash
vercel env pull .env.local
```

### 3. テンプレートExcelファイルの配置

`templates/251203_ガソリン価格比較表.xlsx` を配置してください。

このファイルは、A3用に調整された印刷テンプレートで、「比較表まとめ」シートに6つのセクション（レギュラー/ハイオク/軽油 × 東日本/西日本）が配置されている必要があります。

### 4. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開いてください。

## デバッグ実行

### VS Code でのデバッグ

`.vscode/launch.json` を作成して、以下の設定を追加してください：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Next.js: debug server-side",
      "type": "node-terminal",
      "request": "launch",
      "command": "npm run dev"
    },
    {
      "name": "Next.js: debug client-side",
      "type": "chrome",
      "request": "launch",
      "url": "http://localhost:3000"
    }
  ]
}
```

### 注意事項

- Vercel KVは、ローカル開発時も環境変数が必要です
- テンプレートExcelファイルが存在しない場合、ダウンロード機能はエラーになります
- 初回実行時は、データがまだ更新されていないため、「更新」ボタンを押してデータを取得してください

## ビルド

```bash
npm run build
npm start
```

## デプロイ

Vercelにデプロイする場合：

1. Vercelプロジェクトを作成
2. Vercel KVを有効化
3. GitHubリポジトリを接続
4. 環境変数を設定
5. デプロイ

詳細は `gasoline_price_app_spec.md` を参照してください。

