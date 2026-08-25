# デプロイ手順

配信は Cloudflare Pages。帯域とリクエストが無制限で、無料枠を超えても課金ではなく制限がかかるため、
想定外の請求が発生しない（**要確認**：無料枠の条件は改定されるので、着手時に公式で確認すること）。

## ビルド設定（どの方法でも共通）

| 項目 | 値 |
| --- | --- |
| ビルドコマンド | `npm run build -w @reflog/web` |
| 出力ディレクトリ | `packages/web/dist` |
| ルートディレクトリ | （空欄＝リポジトリルート） |
| Node バージョン | 22 |

モノレポなので**出力先がリポジトリ直下ではない**点に注意。
Node のバージョンは `.node-version` をリポジトリルートに置いて指定している。
既定の Node が古くてビルドが落ちる場合は、環境変数 `NODE_VERSION=22` も併せて設定する。

`packages/web/public/_headers` にキャッシュとセキュリティヘッダを置いてある。
ビルド時に `dist` へそのまま複製され、Cloudflare Pages が読み取る。

## 方法 A: GitHub 連携（採用）

push するだけで自動デプロイされる。API トークンの管理が不要で、
ブランチごとにプレビュー環境が付く。

1. GitHub にリポジトリを作成し、push する

   ```bash
   gh repo create reflog --public --source=. --remote=origin --push
   ```

2. Cloudflare ダッシュボード → Workers & Pages → Create → Pages → Connect to Git
3. リポジトリを選び、上の「ビルド設定」の値を入力する
4. Save and Deploy

以降は `main` に push するたびに本番へ、他ブランチへの push はプレビュー環境へデプロイされる。

## 方法 B: 手元から直接デプロイ

動作確認や、GitHub を経由したくないときに使う。

```bash
npx wrangler login
npm run build -w @reflog/web
npx wrangler pages deploy packages/web/dist --project-name reflog
```

`wrangler login` はブラウザで認証するため、API トークンは不要。

## 方法 C: API トークン（CI から)

GitHub Actions などから自動デプロイする場合のみ必要。

必要なもの:

- **API トークン** — 権限は `Account → Cloudflare Pages → Edit`
- **Account ID** — トークンだけでは対象アカウントが特定できない

環境変数として渡す。**値をコードやチャットに書かないこと。**

```bash
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
npx wrangler pages deploy packages/web/dist --project-name reflog
```

GitHub Actions から使う場合は、リポジトリの Secrets に同名で登録する。

## Workers と D1 を足す段階（Phase 3）

アカウント機能（GitHub OAuth、進捗の同期）を実装すると、静的配信だけでは足りなくなる。
そのときに追加で必要になるもの:

- API トークンの権限に `Workers Scripts → Edit` と `D1 → Edit` を追加
  （Pages とは別権限なので、トークンを作り直すことになる）
- `wrangler.toml` に Workers と D1 バインディングの定義
- GitHub OAuth App の Client ID と Client Secret
  （Secret は Workers 側の Secret に保存する。フロントには絶対に置かない）

ゲーム本体はサーバなしで動き続けるため、Workers が落ちても遊べる状態は保つこと。

## つまずきやすい点

- **出力ディレクトリ** — `dist` ではなく `packages/web/dist`
- **Node のバージョン** — 既定が古いと Vite 8 のビルドが落ちる
- **GitHub API のプロキシは作らない** — サーバ経由にするとレート制限がサーバ IP へ集約されて
  すぐ枯渇する。ブラウザから直接叩けばユーザーごとの枠を使えるので、この構成を崩さない
