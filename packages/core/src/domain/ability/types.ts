/**
 * 修正官が行使できる能力。実体は git のコマンドである。
 *
 * ドメイン層では git の語彙のままにしておく。
 * 「世界線を分岐させる」といったゲーム語彙への翻訳は Presentation 層の責務であり、
 * ここを曖昧にすると、プレイヤーが学んだことを git の知識として持ち帰れなくなる。
 */
import type {
  BranchName,
  ChangeSet,
  CommitId,
  ConflictResolution,
  FactKey,
} from '../timeline/types.ts';

export type AbilityKind =
  | 'commit'
  | 'branch'
  | 'delete-branch'
  | 'checkout'
  | 'merge'
  | 'revert'
  | 'reset'
  | 'cherry-pick'
  | 'tag'
  | 'delete-tag'
  | 'rebase';

/** プレイヤーが実行する 1 手。リプレイと解法検証のためにそのまま記録される。 */
export type AbilityCommand =
  | {
      readonly kind: 'commit';
      readonly message: string;
      readonly changes: ChangeSet;
      readonly narrative?: string;
    }
  | { readonly kind: 'branch'; readonly name: BranchName; readonly at?: CommitId }
  | { readonly kind: 'delete-branch'; readonly name: BranchName }
  | {
      readonly kind: 'checkout';
      readonly target:
        | { readonly type: 'branch'; readonly branch: BranchName }
        | { readonly type: 'commit'; readonly commitId: CommitId };
    }
  | {
      readonly kind: 'merge';
      readonly from: BranchName;
      readonly resolutions?: Readonly<Record<FactKey, ConflictResolution>>;
    }
  | { readonly kind: 'revert'; readonly targetId: CommitId }
  | { readonly kind: 'reset'; readonly targetId: CommitId }
  | {
      readonly kind: 'cherry-pick';
      readonly targetId: CommitId;
      readonly resolutions?: Readonly<Record<FactKey, ConflictResolution>>;
    }
  | { readonly kind: 'tag'; readonly name: string; readonly at?: CommitId }
  | { readonly kind: 'delete-tag'; readonly name: string }
  | {
      readonly kind: 'rebase';
      readonly onto: BranchName;
      readonly resolutions?: Readonly<Record<FactKey, ConflictResolution>>;
    };

/**
 * 因果負荷 —— 歴史を歪めた代償。
 *
 * 歴史を消す操作ほど高い。プレイヤーに「安易に reset しない」動機を与えるための数値であり、
 * 同時に「revert と reset の違い」を体で覚えさせるための仕掛けでもある。
 */
export const CAUSAL_LOAD: Readonly<Record<AbilityKind, number>> = {
  commit: 1,
  branch: 0,
  'delete-branch': 1,
  checkout: 0,
  merge: 2,
  revert: 2,
  reset: 5,
  // 別の世界線から出来事だけを引き抜く。merge より高くつく。
  'cherry-pick': 3,
  // 印を付けるだけで歴史は動かない
  tag: 0,
  'delete-tag': 0,
  // 歴史の並びそのものを作り直す。最も重い術式のひとつ
  rebase: 4,
};

export const causalLoadOf = (command: AbilityCommand): number =>
  CAUSAL_LOAD[command.kind];

/** 手数として数えるか。移動や観測は手数を消費しない。 */
export const countsAsMove = (command: AbilityCommand): boolean =>
  command.kind !== 'checkout';
