/**
 * ドメインが返しうる失敗の全種類。
 * UI 文言はここに書かない（Presentation 層が種別を見て翻訳する）。
 */
export type DomainError =
  | { readonly type: 'CommitNotFound'; readonly commitId: string }
  | { readonly type: 'BranchNotFound'; readonly branch: string }
  | { readonly type: 'BranchAlreadyExists'; readonly branch: string }
  | { readonly type: 'DetachedHeadNotAllowed' }
  | { readonly type: 'NothingToCommit' }
  | { readonly type: 'AlreadyUpToDate'; readonly branch: string }
  | { readonly type: 'MergeConflict'; readonly conflicts: readonly string[] }
  | { readonly type: 'NoMergeBase'; readonly a: string; readonly b: string }
  | { readonly type: 'CannotDeleteCurrentBranch'; readonly branch: string }
  | { readonly type: 'AbilityNotAvailable'; readonly ability: string }
  | { readonly type: 'MoveLimitExceeded'; readonly limit: number }
  | { readonly type: 'CausalLoadExceeded'; readonly limit: number };

export const describe = (e: DomainError): string => {
  switch (e.type) {
    case 'CommitNotFound':
      return `commit not found: ${e.commitId}`;
    case 'BranchNotFound':
      return `branch not found: ${e.branch}`;
    case 'BranchAlreadyExists':
      return `branch already exists: ${e.branch}`;
    case 'DetachedHeadNotAllowed':
      return 'this operation requires HEAD to be on a branch';
    case 'NothingToCommit':
      return 'nothing to commit';
    case 'AlreadyUpToDate':
      return `already up to date: ${e.branch}`;
    case 'MergeConflict':
      return `merge conflict: ${e.conflicts.join(', ')}`;
    case 'NoMergeBase':
      return `no common ancestor between ${e.a} and ${e.b}`;
    case 'CannotDeleteCurrentBranch':
      return `cannot delete the current branch: ${e.branch}`;
    case 'AbilityNotAvailable':
      return `ability not available in this stage: ${e.ability}`;
    case 'MoveLimitExceeded':
      return `move limit exceeded: ${e.limit}`;
    case 'CausalLoadExceeded':
      return `causal load exceeded: ${e.limit}`;
  }
};
