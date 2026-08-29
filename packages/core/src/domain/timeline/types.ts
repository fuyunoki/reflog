/**
 * タイムライン（= コミットグラフ）のデータモデル。
 *
 * 設計方針:
 * - 状態はすべて不変。操作は (state, command) => Result<state, error> の純粋関数として書く。
 * - 状態は JSON にそのままシリアライズできる形にする（Map ではなく Record を使う）。
 *   これによりセーブ・リプレイ・サーバ側での解法再検証がすべて容易になる。
 * - ドメインの語彙は git のまま保つ。「世界線」などのゲーム語彙への翻訳は Presentation 層の責務。
 */

/** コミットの識別子。git のハッシュに相当するが、決定的な短い ID を使う。 */
export type CommitId = string;

/** ブランチ名。git のブランチに相当し、ゲーム上は「世界線の名前」。 */
export type BranchName = string;

/**
 * 世界の事実を表すキー。
 * 例: 'hero.alive', 'lab.invention', 'nation.war'
 * git における「ファイルパス」に相当する。
 */
export type FactKey = string;

/** 事実の値。git における「ファイルの内容」に相当する。 */
export type FactValue = string;

/** ある時点における世界の状態。root から対象コミットまでの ChangeSet を畳み込んだ結果。 */
export type WorldState = Readonly<Record<FactKey, FactValue>>;

/**
 * 1 コミットが世界に加える変更。
 * 値が null のキーは「その事実が失われた」ことを表す（git の削除に相当）。
 */
export type ChangeSet = Readonly<Record<FactKey, FactValue | null>>;

/** 出来事 = コミット。 */
export interface Commit {
  readonly id: CommitId;
  /** 親コミット。0 個 = ルート、1 個 = 通常、2 個 = マージ。 */
  readonly parents: readonly CommitId[];
  /** 出来事の要約。git のコミットメッセージに相当。 */
  readonly message: string;
  /**
   * この時点における世界の完全な状態。
   * git が差分ではなくスナップショットを保存するのと同じモデルを採る。
   * マージのように親が複数ある場合、差分の畳み込みでは状態を一意に復元できないため。
   */
  readonly snapshot: WorldState;
  /**
   * 第一親からの差分。表示用であり、正は snapshot 側。
   * ルートコミットでは snapshot と一致する。
   */
  readonly changes: ChangeSet;
  /** 物語上の描写。ノード選択時にノベルとして表示する。 */
  readonly narrative?: string;
  /** 生成順。表示のソートにのみ使い、グラフの意味論には影響させない。 */
  readonly sequence: number;
}

/** HEAD の状態。ブランチ上にいるか、コミットを直接指しているか。 */
export type Head =
  | { readonly type: 'branch'; readonly branch: BranchName }
  | { readonly type: 'detached'; readonly commitId: CommitId };

/** 破壊的操作の記録。`reflog` 能力（消えた世界線の回収）の裏付けになる。 */
export interface ReflogEntry {
  readonly sequence: number;
  /** 操作の種別。'reset' や 'merge' など。 */
  readonly operation: string;
  /** 操作前に HEAD が指していたコミット。ここへ戻れる。 */
  readonly before: CommitId | null;
  readonly after: CommitId | null;
  readonly note?: string;
}

/** タイムライン全体の状態。これ 1 つでゲームの盤面が完全に決まる。 */
export interface TimelineState {
  readonly commits: Readonly<Record<CommitId, Commit>>;
  readonly branches: Readonly<Record<BranchName, CommitId>>;
  /**
   * 時点に付けた名前。
   * ブランチと違って動かない。「ここが基準だ」と刻んでおくための印。
   */
  readonly tags: Readonly<Record<string, CommitId>>;
  readonly head: Head;
  readonly reflog: readonly ReflogEntry[];
  /**
   * 次のコミットに割り当てる番号。コミット ID は c1, c2, ... と決定的に採番される。
   * branch や checkout はコミットを作らないので、この値を消費しない
   * （消費すると ID が飛び、ステージ定義から特定コミットを参照できなくなる）。
   * reflog 側の順序はこのカウンタとは独立している。
   */
  readonly nextSequence: number;
}

/** merge 実行時に検出された矛盾。ゲーム上は「両立しない 2 つの現実」。 */
export interface Conflict {
  readonly key: FactKey;
  readonly base: FactValue | null;
  readonly ours: FactValue | null;
  readonly theirs: FactValue | null;
}

/** conflict に対するプレイヤーの決断。 */
export type ConflictResolution =
  | { readonly type: 'ours' }
  | { readonly type: 'theirs' }
  | { readonly type: 'custom'; readonly value: FactValue | null };
