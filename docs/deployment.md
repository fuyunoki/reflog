# デプロイとアカウント連携の手順

REFLOG は **サーバなしでも完全に遊べる**。
以下はアカウント連携（記録を別の端末へ持ち歩く）を有効にする場合の手順で、
やらなくてもゲームは動く。

構成は Cloudflare Pages + Pages Functions + D1。
API を Pages Functions に置くことで **Web と API が同一オリジン**になり、
CORS と Cookie の設定という、認証まわりで最も事故が起きやすい部分を構造的に避けている。

## 1. 事前に必要なもの

- Cloudflare アカウント（無料枠でよい）
- GitHub アカウント
- `npx wrangler` が使えること（初回実行時に自動で取得される）

## 2. D1 データベースを作る

```bash
npx wrangler d1 create reflog
```

出力に `database_id` が出るので、`packages/web/wrangler.toml` の
`REPLACE_WITH_YOUR_D1_DATABASE_ID` を置き換える。

続けてテーブルを作る。

```bash
npm run cf:migrate -w @reflog/web
```

ローカルの D1 に対して試したい場合は `--remote` を `--local` に読み替える。

## 3. GitHub OAuth App を作る

GitHub の **Settings → Developer settings → OAuth Apps → New OAuth App** で登録する。

| 項目 | 値 |
| --- | --- |
| Application name | REFLOG（任意） |
| Homepage URL | `https://<your-project>.pages.dev` |
| Authorization callback URL | `https://<your-project>.pages.dev/api/auth/callback` |

**Callback URL のパスは `/api/auth/callback` でなければならない。**
ここが一致しないと認証が最後で失敗する。

作成後、Client ID を控え、Client secret を生成して控える。

### 権限について

このゲームが求めるスコープは `read:user` だけで、リポジトリの中身には触れない。
必要以上の権限を求めると、それだけでログインをためらわせるため、意図的に最小にしてある。

## 4. シークレットを設定する

Cloudflare のダッシュボードで **Pages → プロジェクト → Settings → Environment variables**
を開き、以下を **Secret** として登録する（Plaintext ではなく Secret にすること）。

| 名前 | 値 |
| --- | --- |
| `GITHUB_CLIENT_ID` | OAuth App の Client ID |
| `GITHUB_CLIENT_SECRET` | OAuth App の Client secret |

`client_secret` はサーバ側でしか使わず、ブラウザには一切渡らない。
これがこのプロジェクトで唯一サーバが構造的に必要になる理由でもある。

## 5. デプロイする

```bash
npm run cf:deploy -w @reflog/web
```

D1 のバインディングは Pages の設定画面（Settings → Functions → D1 database bindings）
でも紐付ける必要がある。バインディング名は `DB`。

## 6. ローカルで確かめる

通常の開発は Vite で足りる。API は無いが、その場合は未ログインとして遊べる状態に落ちる。

```bash
npm run dev -w @reflog/web
```

API まで含めて確かめたい場合は、ビルドしてから Pages の開発サーバで動かす。

```bash
npm run build -w @reflog/web
npx wrangler pages dev dist --d1 DB=reflog
```

## 7. 動作の確認

1. トップの「GitHub でログイン」を押す
2. GitHub の認可画面で許可する
3. トップに戻り、「<ユーザー名> としてログイン中」と出れば成功

失敗した場合は `?auth=...` を付けて戻り、画面に理由が出る。

| 表示 | よくある原因 |
| --- | --- |
| 認証の照合に失敗した | Cookie がブロックされている。または時間を置きすぎた（state の有効期限は 10 分） |
| GitHub との認証に失敗した | Client ID / Secret の設定漏れ、Callback URL の不一致 |
| ログインできなかった | D1 のバインディング名が `DB` になっていない |

## 8. データの持ち方

| テーブル | 内容 |
| --- | --- |
| `players` | GitHub の数値 ID を元にした識別子と表示名 |
| `progress` | 進捗の JSON を 1 行 1 プレイヤーで保持 |
| `sessions` | セッショントークンと有効期限（30 日） |

**サーバは進捗の中身を解釈しない。** 形を決めるのはドメイン側であり、
サーバはそれをそのまま預かるだけにしてある。
こうしておくと、ゲームの仕様が変わってもマイグレーションが要らない。

アクセストークンは保存していない。ユーザーの識別さえできればよく、
持ち続けると漏れたときの被害が大きくなるため。

## 9. 費用について

- Pages の配信は帯域・リクエストとも無制限
- Functions（Workers）は 10 万リクエスト/日
- D1 は書き込み 10 万行/日、5 GB

ゲームの進行・判定・ステージ生成はすべてブラウザで動くので、
サーバを呼ぶのは進捗の保存とログインのときだけになる。
利用者が増えてもコストがほぼ増えない構造にしてある。

**無料枠の数値は改定されるため、着手時に公式を確認すること。**
なお Cloudflare は無料枠を超えたとき、課金ではなく制限（リクエストを弾く）になる。
想定外の請求が発生しない点も、この構成を選んだ理由のひとつ。
