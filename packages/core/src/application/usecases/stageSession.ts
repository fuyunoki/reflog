/**
 * ステージのプレイ進行。ドメインの純粋関数の上に、手数・因果負荷・アンドゥを載せる。
 *
 * commands にプレイヤーの手が順に積まれるため、これ 1 つでリプレイと
 * サーバ側での解法再検証（チート対策）が成立する。
 */
import { type Result, ok, err } from '../../domain/shared/result.ts';
import type { DomainError } from '../../domain/shared/errors.ts';
import { executeAbility } from '../../domain/ability/execute.ts';
import { causalLoadOf, countsAsMove } from '../../domain/ability/types.ts';
import type { AbilityCommand, AbilityKind } from '../../domain/ability/types.ts';
import { evaluateGoals } from '../../domain/stage/goal.ts';
import type { GoalReport } from '../../domain/stage/goal.ts';
import { buildInitialTimeline } from '../../domain/stage/spec.ts';
import type { StageSpec } from '../../domain/stage/spec.ts';
import type { TimelineState } from '../../domain/timeline/types.ts';

export type SessionStatus = 'playing' | 'cleared';

export interface StageSession {
  readonly spec: StageSpec;
  /**
   * このプレイで実際に行使できる能力。
   *
   * ステージが指定するものに加え、これまでの訓練で習得したものを含む。
   * 一度渡された術式が後の記録で使えなくなるのは不自然なので、積み上げていく。
   */
  readonly abilities: readonly AbilityKind[];
  readonly timeline: TimelineState;
  readonly movesUsed: number;
  readonly causalLoad: number;
  /** プレイヤーが打った手。リプレイと検証に使う。 */
  readonly commands: readonly AbilityCommand[];
  /** アンドゥ用のスナップショット。不変状態なので保持するだけでよい。 */
  readonly past: readonly StageSession[];
  readonly status: SessionStatus;
  readonly report: GoalReport;
}

const snapshotWithout = (session: StageSession): StageSession => ({
  ...session,
  past: [],
});

export const startStage = (
  spec: StageSpec,
  /** これまでに習得している能力。ステージ指定分と合わせて使えるようになる。 */
  learned: readonly AbilityKind[] = [],
): Result<StageSession, DomainError> => {
  const timeline = buildInitialTimeline(spec);
  if (!timeline.ok) return timeline;

  const abilities = [...new Set<AbilityKind>([...spec.abilities, ...learned])];
  const report = evaluateGoals(timeline.value, spec.goals);
  return ok({
    spec,
    abilities,
    timeline: timeline.value,
    movesUsed: 0,
    causalLoad: 0,
    commands: [],
    past: [],
    status: report.cleared ? 'cleared' : 'playing',
    report,
  });
};

export const playAbility = (
  session: StageSession,
  command: AbilityCommand,
): Result<StageSession, DomainError> => {
  const { spec } = session;

  const nextMoves = session.movesUsed + (countsAsMove(command) ? 1 : 0);
  if (spec.moveLimit !== undefined && nextMoves > spec.moveLimit) {
    return err({ type: 'MoveLimitExceeded', limit: spec.moveLimit });
  }

  const nextLoad = session.causalLoad + causalLoadOf(command);
  if (spec.causalLoadLimit !== undefined && nextLoad > spec.causalLoadLimit) {
    return err({ type: 'CausalLoadExceeded', limit: spec.causalLoadLimit });
  }

  const timeline = executeAbility(session.timeline, command, session.abilities);
  if (!timeline.ok) return timeline;

  const report = evaluateGoals(timeline.value, spec.goals);
  return ok({
    spec,
    abilities: session.abilities,
    timeline: timeline.value,
    movesUsed: nextMoves,
    causalLoad: nextLoad,
    commands: [...session.commands, command],
    past: [...session.past, snapshotWithout(session)],
    status: report.cleared ? 'cleared' : 'playing',
    report,
  });
};

export const canUndo = (session: StageSession): boolean => session.past.length > 0;

export const undo = (session: StageSession): StageSession => {
  const previous = session.past[session.past.length - 1];
  if (!previous) return session;
  return { ...previous, past: session.past.slice(0, -1) };
};

/**
 * コマンド列を最初から再生する。
 * リプレイ表示と、サーバ側での解法検証の両方がこの 1 関数で済む。
 */
export const replay = (
  spec: StageSpec,
  commands: readonly AbilityCommand[],
  learned: readonly AbilityKind[] = [],
): Result<StageSession, DomainError> => {
  let session = startStage(spec, learned);
  if (!session.ok) return session;

  for (const command of commands) {
    const next = playAbility(session.value, command);
    if (!next.ok) return next;
    session = next;
  }
  return session;
};
