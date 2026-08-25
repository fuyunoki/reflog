/**
 * ドメインの語彙を、プレイヤーに見せる言葉へ翻訳する。
 *
 * ドメイン層は git の語彙（commit / branch / merge）のまま保ってある。
 * 学んだことを git の知識として持ち帰れるようにするためであり、
 * 世界観の言葉に置き換えるのはこの層の責務。
 *
 * 能力名そのものは英字の git コマンドのまま見せる。
 * 「REVERT とは、出来事を打ち消すこと」と対応づけて覚えてもらうのが狙い。
 */
import type { AbilityKind, DomainError, FactKey, FactValue, StageSpec } from '@reflog/core';

// --- 事実の表示 -------------------------------------------------------------

/** 手作りステージ用の既定ラベル。生成ステージは spec.factLabels を持つ。 */
const FALLBACK_FACTS: Record<string, string> = {
  'kirishima.alive': '霧島湊の生存',
  'lab.device': '観測装置',
  'lab.status': '研究所',
};

const FALLBACK_VALUES: Record<string, string> = {
  true: '生存',
  false: '死亡',
  prototype: '試作段階',
  sealed: '封印',
  complete: '完成',
  operating: '稼働中',
  closed: '閉鎖',
};

export const factLabel = (spec: StageSpec, key: FactKey): string =>
  spec.factLabels?.[key] ?? FALLBACK_FACTS[key] ?? key;

export const valueLabel = (
  spec: StageSpec,
  value: FactValue | null | undefined,
): string => {
  if (value === null || value === undefined) return '——';
  return spec.valueLabels?.[value] ?? FALLBACK_VALUES[value] ?? value;
};

// --- 能力の表示 -------------------------------------------------------------

export interface AbilityPresentation {
  /** 画面に出す名前。git のコマンド名をそのまま使う。 */
  readonly name: string;
  /** 何が起きるかの一文。 */
  readonly effect: string;
  /** 破壊的か。歴史が消える操作は視覚的に区別する。 */
  readonly destructive: boolean;
}

export const ABILITY: Record<AbilityKind, AbilityPresentation> = {
  commit: {
    name: 'COMMIT',
    effect: '新たな出来事を刻む',
    destructive: false,
  },
  branch: {
    name: 'BRANCH',
    effect: 'この時点から世界線を分岐させる',
    destructive: false,
  },
  'delete-branch': {
    name: 'DROP',
    effect: '世界線への参照を捨てる',
    destructive: true,
  },
  checkout: {
    name: 'CHECKOUT',
    effect: '観測する世界線を移す',
    destructive: false,
  },
  merge: {
    name: 'MERGE',
    effect: '二つの世界線を統合する',
    destructive: false,
  },
  revert: {
    name: 'REVERT',
    effect: '出来事を打ち消す。記録は残る',
    destructive: false,
  },
  reset: {
    name: 'RESET',
    effect: '時点ごと巻き戻す。歴史が消える',
    destructive: true,
  },
};

// --- エラーの表示 -----------------------------------------------------------

/**
 * ドメインエラーを世界観の文言にする。
 * ドメインは種別しか返さない（文言を持たない）ので、翻訳はここで行う。
 */
export const errorMessage = (error: DomainError): string => {
  switch (error.type) {
    case 'CommitNotFound':
      return 'その時点は観測できない。';
    case 'BranchNotFound':
      return 'その世界線は存在しない。';
    case 'BranchAlreadyExists':
      return 'その名の世界線はすでにある。';
    case 'DetachedHeadNotAllowed':
      return '世界線上にいないため、この操作はできない。';
    case 'NothingToCommit':
      return 'この時点では、世界は何も変わらない。';
    case 'AlreadyUpToDate':
      return 'その世界線はすでに取り込まれている。';
    case 'MergeConflict':
      return '両立しない現実がある。決断が要る。';
    case 'NoMergeBase':
      return '二つの世界線に共通の起点がない。統合はできない。';
    case 'CannotDeleteCurrentBranch':
      return 'いま立っている世界線は捨てられない。';
    case 'AbilityNotAvailable':
      return 'その能力はまだ行使できない。';
    case 'MoveLimitExceeded':
      return '手数の上限に達している。';
    case 'CausalLoadExceeded':
      return '因果負荷が限界を超える。これ以上は世界がもたない。';
  }
};

// --- その他 -----------------------------------------------------------------

/** コミット ID の表示形。git の短縮ハッシュに相当する見せ方をする。 */
export const commitLabel = (id: string): string => id.toUpperCase();

/** 長いメッセージをノード脇に収める。 */
export const truncate = (text: string, max = 13): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;
