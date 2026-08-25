/**
 * 能力コマンドをタイムライン操作にディスパッチする。
 *
 * ここが「1 手」の単位であり、リプレイ・アンドゥ・サーバ側での解法再検証は
 * すべてこの関数にコマンド列を流し込むだけで実現できる。
 */
import { type Result, err } from '../shared/result.ts';
import type { DomainError } from '../shared/errors.ts';
import {
  checkout,
  commit,
  createBranch,
  deleteBranch,
  merge,
  reset,
  revert,
} from '../timeline/operations.ts';
import type { TimelineState } from '../timeline/types.ts';
import type { AbilityCommand, AbilityKind } from './types.ts';

export const executeAbility = (
  state: TimelineState,
  command: AbilityCommand,
  available?: readonly AbilityKind[],
): Result<TimelineState, DomainError> => {
  if (available && !available.includes(command.kind)) {
    return err({ type: 'AbilityNotAvailable', ability: command.kind });
  }

  switch (command.kind) {
    case 'commit':
      return commit(state, {
        message: command.message,
        changes: command.changes,
        narrative: command.narrative,
      });
    case 'branch':
      return createBranch(state, command.name, command.at);
    case 'delete-branch':
      return deleteBranch(state, command.name);
    case 'checkout':
      return checkout(state, command.target);
    case 'merge':
      return merge(state, { from: command.from, resolutions: command.resolutions });
    case 'revert':
      return revert(state, command.targetId);
    case 'reset':
      return reset(state, command.targetId);
  }
};
