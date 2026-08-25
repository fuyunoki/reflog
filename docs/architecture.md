# アーキテクチャ設計

## 1. 方針

クリーンアーキテクチャを採用する。この題材で採用する理由は 2 つ。

1. **Timeline Engine が本質的に純粋なドメインロジック**であり、UI・GitHub API・永続化から独立させるべき対象そのものである
2. 「コアはフロント完結、拡張は後からサーバ」という開発方針が**依存性逆転そのもの**である。
   永続化ポートの実装を localStorage から D1 に差し替えるだけで Phase 5 に移行できる

## 2. レイヤ構成

```
┌─────────────────────────────────────────────┐
│ Frameworks & Drivers                        │
│  Vue / SVG描画 / fetch / localStorage / D1   │
├─────────────────────────────────────────────┤
│ Interface Adapters                          │
│  Pinia store (ViewModel) / Repository実装    │
│  GitHub Gateway実装 / Stage JSON ローダ      │
├─────────────────────────────────────────────┤
│ Application (Use Cases)  ← ポートを定義      │
│  StartStage / ExecuteAbility / EvaluateGoal │
├─────────────────────────────────────────────┤
│ Domain (Entities)        ← 依存ゼロ          │
│  TimelineGraph / Commit / Ref / Ability     │
│  mergeBase / threeWayMerge / GoalPredicate  │
└─────────────────────────────────────────────┘
             依存方向は常に内向き
```

## 3. ディレクトリ構成（npm workspaces モノレポ）

```
packages/
  core/                      # 依存ゼロ。Vue も fetch も知らない
    src/
      domain/
        timeline/            # TimelineGraph, Commit, Ref, mergeBase, threeWayMerge
        ability/             # 能力(= git コマンド)の定義と実行規則
        stage/               # StageSpec, GoalPredicate とその評価器
        shared/              # Result, DomainError, 値オブジェクト
      application/
        ports/               # ProgressRepository / GitHubGateway / StageSource (interface)
        usecases/            # StartStage, ExecuteAbility, EvaluateGoal, ImportAccount
  web/                       # Vue アプリ
    src/
      presentation/          # components, SVG レンダラ, ゲーム語彙への変換, デザイントークン
      stores/                # Pinia = ViewModel 兼 Controller
      infrastructure/        # LocalStorageProgressRepository, FetchGitHubGateway
      main.ts                # 合成ルート（DI の組み立て）
  server/                    # Phase 5 / Cloudflare Workers
    src/infrastructure/      # D1ProgressRepository, ランキングハンドラ
                             # core を import してクリア判定を再実行する
```

`core` を独立パッケージにするのが要点。
Vue アプリと Workers の**両方から同じ判定ロジックを import できる**ため、クリア判定の二重実装が構造的に発生しない。

## 4. 設計上の重要な判断

### 4.1 ドメイン層は git 語彙、表示層でゲーム語彙に変換する

Domain では `Commit` `Branch` `merge` のまま扱い、Presentation で「時点」「世界線」「統合」に翻訳する。
**教材としての学習転移**を殺さないため。ドメインを世界観語彙で書くと、プレイヤーが git の知識として持ち帰れなくなる。

### 4.2 状態は不変、能力実行は純粋関数

```ts
type ExecuteAbility = (
  state: TimelineState,
  command: AbilityCommand
) => Result<TimelineState, DomainError>
```

これによって以下がすべて副産物として得られる。

- アンドゥ / リドゥ
- リプレイ（コマンド列の再生）
- サーバ側での解法再検証（チート対策）
- `reflog` の実装（参照が切れたノードの保持）

### 4.3 ポートは Application 側に置く（DIP）

```ts
// application/ports
interface GitHubGateway {
  fetchUserTimeline(username: string): Promise<Result<AccountSnapshot, GatewayError>>
}

interface ProgressRepository {
  load(playerId: PlayerId): Promise<PlayerProgress>
  save(progress: PlayerProgress): Promise<void>
}

interface StageSource {
  list(): Promise<StageSummary[]>
  get(id: StageId): Promise<Result<StageSpec, LoadError>>
}
```

実装は `web/infrastructure`（fetch / localStorage）と `server/infrastructure`（D1）に置き、**合成ルートで注入**する。
DI コンテナは不要。`main.ts` での手動注入で十分。
未認証 API → OAuth への移行も、Gateway 実装の差し替えだけで完了する。

### 4.4 依存ルールを機械的に強制する

人間の規律に任せると必ず崩れるため、ESLint の `no-restricted-imports`（または dependency-cruiser）で
**`core` から `vue` や DOM API を import したら CI で落ちる**ようにする。
長期育成前提のプロジェクトでは、この投資が最も効く。

## 5. 過剰適用を避ける線引き

クリーンアーキテクチャを教条的に適用すると、この規模では破綻する。以下は意図的に妥協する。

- **Presenter を厳密に分離しない**。Vue の reactivity と噛み合わず苦しくなるため、ViewModel は Pinia store が兼ねる
- **ユースケースを全部クラスにしない**。純粋関数で足りるものは関数のままにする
- **Domain のテストに全振りする**。ここが純粋なのでユニットテストが極めて書きやすく、投資対効果が最大。
  逆に UI の E2E は最小限に留める

## 6. デザイントークンの位置づけ

デザイントークンは **Presentation 層に完全に閉じる**。Domain は色を一切知らない。
ドメインが返す状態を Presentation でトークンにマッピングする。

```ts
// presentation/theme
const conflictSeverityToken = {
  none:    'var(--ink-muted)',
  warning: 'var(--accent)',
  // ...
}
```

これによりダークテーマを追加してもドメインは無傷である。

## 7. サーバの段階的導入

ゲーム本体はフロント完結のまま維持し、サーバは**すべてオプショナルな拡張レイヤ**とする。
本体がサーバ必須になると、無料で気軽に遊んでもらえる利点を失うため。

```
コア（サーバ無しで完全に遊べる）
  Timeline Engine / ステージ / 演出           → Cloudflare Pages

拡張レイヤ（有ると良いが、無くても成立する）
  OAuth / セーブ同期 / ランキング / 解法検証 / UGC 投稿
```

サーバを導入する必然性がある順:

1. **OAuth のトークン交換** — `client_secret` はフロントに置けないため構造的に必要
2. **ランキングとリプレイ共有** — ゲームの寿命に直結。サーバなしでは実現不可能
3. **クリア判定のサーバ再検証** — ランキングを作るなら解法の再実行検証が必須
4. **UGC 投稿** — 投稿・検証・配信・モデレーション。ここまで来ると通常の Web アプリ開発になる

**注意**: レート制限を理由に GitHub API をサーバでプロキシしてはならない。
サーバ IP に集約されて即座に枯渇し、結局トークンが必須になる。
ブラウザ直叩きならユーザーの IP 枠を使うため、利用者が増えてもコストが発生しない。
サーバを挟む本当の理由は private リポジトリ対応とキャッシュである。

## 8. テスト戦略

| 対象 | 手法 | 優先度 |
| --- | --- | --- |
| Domain（Timeline Engine） | ユニットテスト。純粋関数なので網羅的に書く | **最高** |
| Application（ユースケース） | ポートをスタブして単体テスト | 高 |
| Infrastructure | 実 API はモック。契約テストのみ | 中 |
| Presentation | 主要導線のみ E2E | 低 |

特に `mergeBase` と 3-way merge は git の意味論の核であり、
ここにバグがあるとゲームが「間違った git」を教えることになる。最も厚くテストする。
