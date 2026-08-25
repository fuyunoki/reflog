# REFLOG（リフログ）

GitHub アカウントを素材に取り込み、**タイムライン（コミットグラフ）を操作して世界を修正する**体験型 Web ゲーム。
プレイヤーが行使する能力は git のコマンド体系そのもので、遊んでいるうちに git の内部モデルが身につく。

- 構想: [docs/concept.md](docs/concept.md)
- アーキテクチャ: [docs/architecture.md](docs/architecture.md)
- 進行設計（物語・無限性・難易度・アカウント）: [docs/progression.md](docs/progression.md)
- デプロイとアカウント連携: [docs/deployment.md](docs/deployment.md)
- UI モック（実際に第 1 章が遊べる）: [docs/mock/stage-ui.html](docs/mock/stage-ui.html)

## 現在の状態

Phase 0（Timeline Engine のコア）まで完了。

| Phase | 内容 | 状態 |
| --- | --- | --- |
| 0 | Timeline Engine コア + ステージ定義 + 目標判定 | 完了 |
| 0.5 | 自動生成・難易度・物語分岐・記録の統合（ドメイン） | 完了 |
| 1 | Vue アプリ、SVG 可視化、conflict 解決 UI、コマンドコンソール | 完了 |
| 2 | 訓練章（CH 00）、段階的な手引き | 完了 |
| 3 | GitHub OAuth + Pages Functions + D1（アカウント） | 完了 |
| 3.5 | 第 1 章の残りシナリオ、演出の作り込み | 未着手 |
| 4 | cherry-pick / rebase / bisect / reflog と後半章 | 未着手 |
| 5 | ステージエディタ、ランキング、UGC | 未着手 |

## 構成

```
packages/
  core/            依存ゼロ。Vue も fetch も知らないドメイン層
    src/
      domain/
        timeline/  コミットグラフ、3-way merge、各種操作
        ability/   能力（= git コマンド）の定義と実行
        stage/     ステージ定義、目標述語、難易度、自動生成
        shared/    Result 型とドメインエラー
        campaign/  物語の分岐条件と章の解放
      application/
        ports/     外界との境界（interface のみ）
        usecases/  ステージ進行、リプレイ、記録の統合
  web/             Vue アプリ
    src/
      presentation/  コンポーネント、SVG レイアウト、語彙の翻訳、デザイントークン
      stores/        Pinia（ViewModel 兼 Controller）
      infrastructure/ ステージ読み込み、進捗保存
    functions/     Pages Functions（認証と記録の API）
    migrations/    D1 のスキーマ
content/
  stages/          ステージ定義（JSON）。シナリオ追加 = JSON 追加
docs/              構想・アーキテクチャ・進行設計・UI モック
```

## 開発

Node.js 22 以上が必要（TypeScript を型除去でそのまま実行するため）。

```bash
npm install
npm test          # ドメインのユニットテスト
npm run typecheck # 型チェック
```

アプリを動かす。

```bash
npm run dev -w @reflog/web
```

### 初めて遊ぶ人向けの導線

- ホームで「何をする遊びなのか」を世界観より先に言い切る
- 用語の対応表（時点＝コミット、世界線＝ブランチ…）を折りたためる形で置く
- 訓練章（CH 00）で操作を一つずつ教える。手引きは条件を満たすと自動で次へ進む

手引きの進み具合はセッションから毎回導出しているので、
アンドゥしても手引きだけが取り残されることがない。

### 操作には二つの入口がある

同じ 1 手を、パネルのボタンからもコンソールからも打てる。画面右上でいつでも切り替わる。

| 入口 | 狙い |
| --- | --- |
| パネル | 何ができるかが一覧で見え、概念を掴める |
| コンソール | `git revert c2` のように本物の構文で打つ。実務にそのまま持ち帰れる |

どちらの入口も同じ `AbilityCommand` に落ちるため、その先の経路は完全に共通。
コンソールは `git log` `git status` `git branch` `git reflog` にも応える。

### 設計上の約束

- **ドメイン層は git の語彙を保つ**。「世界線」などゲーム語彙への翻訳は Presentation 層の責務
- **状態は不変、操作は純粋関数**。ここからアンドゥ・リプレイ・サーバ側での解法検証がすべて得られる
- **`core` は外界を知らない**。Vue も fetch も localStorage も import しない
- ステージのテストは実装検証ではなく**ゲームデザインの検証**を兼ねる
  （想定解で解けるか、手抜き解法が封じられているか、誤答が何かを教えるか）
- 自動生成は逆算で作る。生成時に想定解を実行し、到達状態を目標にするので、
  **解けない任務が原理的に出ない**
- 矛盾の決断は必ず達成条件に反映する。どちらを選んでもクリアできるなら、
  conflict はただの手続きになってしまう
