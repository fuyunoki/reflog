/**
 * 外界との境界（ポート）。
 *
 * 実装は Interface Adapters 層に置き、合成ルートで注入する。
 * ここに interface を置くことで依存が内向きに反転し、
 * localStorage → D1、未認証 API → OAuth の差し替えが実装の入れ替えだけで済む。
 */
import type { Result } from '../../domain/shared/result.ts';
import type { AbilityCommand } from '../../domain/ability/types.ts';
import type { StageId, StageSpec } from '../../domain/stage/spec.ts';
import type { DifficultyLevel, MissionOutcome } from '../../domain/stage/difficulty.ts';
import type { RecordedChoice } from '../../domain/campaign/types.ts';

// --- ステージの供給 ---------------------------------------------------------

export interface StageSummary {
  readonly id: StageId;
  readonly title: string;
  readonly chapterNumber: number;
}

export type LoadError =
  | { readonly type: 'NotFound'; readonly id: StageId }
  | { readonly type: 'Malformed'; readonly reason: string };

export interface StageSource {
  list(): Promise<readonly StageSummary[]>;
  get(id: StageId): Promise<Result<StageSpec, LoadError>>;
}

// --- 進捗の永続化 -----------------------------------------------------------

export type PlayerId = string;

export interface StageRecord {
  readonly stageId: StageId;
  readonly cleared: boolean;
  readonly perfect: boolean;
  readonly bestMoves: number;
  readonly bestCausalLoad: number;
  /** 最良解のコマンド列。リプレイ共有とサーバ検証に使う。 */
  readonly bestSolution: readonly AbilityCommand[];
  readonly clearedAt: string;
}

/**
 * プレイヤーの全記録。
 *
 * これは単なるセーブデータではなく「そのプレイヤーが作った世界」そのものである。
 * choices に積まれた決断が、後の章の分岐条件として参照される。
 */
export interface PlayerProgress {
  readonly playerId: PlayerId;
  readonly records: Readonly<Record<StageId, StageRecord>>;
  /** conflict でどちらの現実を選んだかの履歴。物語の分岐条件になる。 */
  readonly choices: readonly RecordedChoice[];
  /** 観測任務の成績。適応的難易度の入力。 */
  readonly missionLog: readonly MissionOutcome[];
  readonly currentDifficulty: DifficultyLevel;
  /** 次に配信する観測任務の番号。 */
  readonly nextMissionNumber: number;
  /** GitHub 連携で得た素材。未連携なら null。 */
  readonly account: AccountSnapshot | null;
  readonly updatedAt: string;
}

export interface ProgressRepository {
  load(playerId: PlayerId): Promise<PlayerProgress>;
  save(progress: PlayerProgress): Promise<void>;
}

// --- 認証 -------------------------------------------------------------------

export interface AuthenticatedUser {
  readonly playerId: PlayerId;
  readonly username: string;
  readonly avatarUrl: string | null;
}

export type AuthError =
  | { readonly type: 'Cancelled' }
  | { readonly type: 'ExchangeFailed'; readonly reason: string }
  | { readonly type: 'NetworkError'; readonly reason: string };

/**
 * 認証。
 *
 * 未ログインでも遊べることが前提であり、ログインは「進捗を持ち歩けるようにする」機能。
 * client_secret を扱う必要があるため、トークン交換だけはサーバ側で行う。
 */
export interface AuthGateway {
  /** 現在のログイン状態。未ログインなら null。 */
  currentUser(): Promise<Result<AuthenticatedUser | null, AuthError>>;
  /**
   * 認可を始める。リダイレクト方式では制御が戻らないため、戻り値を持たない。
   * 認可後の処理はサーバ側で完結し、ブラウザはトップに戻ってくる。
   */
  beginLogin(): void;
  logout(): Promise<void>;
}

// --- GitHub 連携 ------------------------------------------------------------

/**
 * プレイヤーのアカウントから取り込んだ素材。
 * 診断結果ではなく、あくまでゲームの素材として扱う。
 */
export interface AccountSnapshot {
  readonly username: string;
  /** 因果エネルギーの元になる活動量。 */
  readonly contributionCount: number;
  /** 修正官の適性を決める主要言語。 */
  readonly primaryLanguages: readonly string[];
  /** 訪問可能な世界線の候補。 */
  readonly repositories: readonly RepositorySnapshot[];
  readonly fetchedAt: string;
}

export interface RepositorySnapshot {
  readonly name: string;
  readonly description: string | null;
  readonly language: string | null;
  readonly stars: number;
  readonly commits: readonly CommitSnapshot[];
}

export interface CommitSnapshot {
  readonly sha: string;
  readonly message: string;
  readonly authoredAt: string;
}

export type GatewayError =
  | { readonly type: 'UserNotFound'; readonly username: string }
  /** レート制限。IP 単位で 60 req/h。デフォルト世界線へ誘導すること。 */
  | { readonly type: 'RateLimited'; readonly resetAt: string | null }
  | { readonly type: 'NetworkError'; readonly reason: string };

export interface GitHubGateway {
  fetchAccount(username: string): Promise<Result<AccountSnapshot, GatewayError>>;
}
