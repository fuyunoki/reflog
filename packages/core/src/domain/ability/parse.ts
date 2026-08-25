/**
 * git コマンド文字列の解釈。
 *
 * ボタンで概念を覚え、コンソールで実際のコマンドを覚える、という二段構えのための入口。
 * 構文は本物の git に合わせる。ここで覚えたことがそのまま実務で使えないと、
 * 教材としての意味が半分になる。
 *
 * 解釈だけを行い、実行はしない。副作用がないのでテストしやすい。
 */
import { type Result, ok, err } from '../shared/result.ts';
import type { BranchName, CommitId } from '../timeline/types.ts';
import type { AbilityCommand } from './types.ts';

/** 状態を変えない問い合わせ。 */
export type QueryKind = 'log' | 'status' | 'branch' | 'reflog' | 'help';

export type ConsoleAction =
  | { readonly kind: 'ability'; readonly command: AbilityCommand }
  /**
   * merge だけは特別扱いする。
   * 矛盾が起きるかは実行してみないと分からず、
   * --ours / --theirs が指定されたかどうかで UI の出し方が変わるため。
   */
  | {
      readonly kind: 'merge';
      readonly from: BranchName;
      readonly strategy: 'ask' | 'ours' | 'theirs';
    }
  | { readonly kind: 'query'; readonly query: QueryKind };

export type ParseError =
  | { readonly type: 'Empty' }
  | { readonly type: 'NotGit'; readonly input: string }
  | { readonly type: 'UnknownCommand'; readonly command: string }
  | {
      readonly type: 'MissingArgument';
      readonly command: string;
      readonly expected: string;
    }
  | { readonly type: 'UnknownOption'; readonly option: string; readonly command: string }
  | { readonly type: 'TooManyArguments'; readonly command: string };

const SUPPORTED = [
  'revert',
  'merge',
  'checkout',
  'switch',
  'branch',
  'reset',
  'log',
  'status',
  'reflog',
  'help',
] as const;

/** コミット ID は大小どちらで打たれても受ける。 */
const normalizeRef = (ref: string): string => ref.trim();

const isCommitish = (ref: string): boolean => /^c\d+$/i.test(ref);

const toCommitId = (ref: string): CommitId => ref.toLowerCase();

const splitTokens = (input: string): string[] =>
  input
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);

export const parseCommand = (input: string): Result<ConsoleAction, ParseError> => {
  const tokens = splitTokens(input);
  if (tokens.length === 0) return err({ type: 'Empty' });

  // 先頭の git は省略できる。help だけは単体でも通す。
  let rest = tokens;
  if (tokens[0]?.toLowerCase() === 'git') {
    rest = tokens.slice(1);
    if (rest.length === 0) return err({ type: 'MissingArgument', command: 'git', expected: 'サブコマンド' });
  } else if (tokens[0]?.toLowerCase() !== 'help') {
    // git を省いた形も許すが、知らない語なら「git を付けろ」とは言わずに素直に不明として返す
    const head = tokens[0]?.toLowerCase() ?? '';
    if (!SUPPORTED.includes(head as (typeof SUPPORTED)[number])) {
      return err({ type: 'NotGit', input: tokens[0] as string });
    }
  }

  const command = (rest[0] ?? '').toLowerCase();
  const args = rest.slice(1);
  const options = args.filter((a) => a.startsWith('-'));
  const positional = args.filter((a) => !a.startsWith('-'));

  switch (command) {
    case 'revert': {
      const target = positional[0];
      if (!target) {
        return err({ type: 'MissingArgument', command: 'revert', expected: '<commit>' });
      }
      if (positional.length > 1) return err({ type: 'TooManyArguments', command: 'revert' });
      return ok({
        kind: 'ability',
        command: { kind: 'revert', targetId: toCommitId(normalizeRef(target)) },
      });
    }

    case 'merge': {
      const from = positional[0];
      if (!from) {
        return err({ type: 'MissingArgument', command: 'merge', expected: '<branch>' });
      }
      let strategy: 'ask' | 'ours' | 'theirs' = 'ask';
      for (const option of options) {
        if (option === '--ours' || option === '-Xours') strategy = 'ours';
        else if (option === '--theirs') strategy = 'theirs';
        else return err({ type: 'UnknownOption', option, command: 'merge' });
      }
      return ok({ kind: 'merge', from: normalizeRef(from), strategy });
    }

    case 'checkout':
    case 'switch': {
      const target = positional[0];
      if (!target) {
        return err({ type: 'MissingArgument', command, expected: '<branch|commit>' });
      }
      const ref = normalizeRef(target);
      return ok({
        kind: 'ability',
        command: {
          kind: 'checkout',
          target: isCommitish(ref)
            ? { type: 'commit', commitId: toCommitId(ref) }
            : { type: 'branch', branch: ref },
        },
      });
    }

    case 'branch': {
      const deleting = options.includes('-d') || options.includes('-D') || options.includes('--delete');
      const unknown = options.find(
        (o) => !['-d', '-D', '--delete'].includes(o),
      );
      if (unknown) return err({ type: 'UnknownOption', option: unknown, command: 'branch' });

      if (deleting) {
        const name = positional[0];
        if (!name) {
          return err({ type: 'MissingArgument', command: 'branch -d', expected: '<branch>' });
        }
        return ok({
          kind: 'ability',
          command: { kind: 'delete-branch', name: normalizeRef(name) },
        });
      }

      // 引数なしの git branch は一覧表示
      if (positional.length === 0) return ok({ kind: 'query', query: 'branch' });

      const name = normalizeRef(positional[0] as string);
      const start = positional[1];
      return ok({
        kind: 'ability',
        command: start
          ? { kind: 'branch', name, at: toCommitId(normalizeRef(start)) }
          : { kind: 'branch', name },
      });
    }

    case 'reset': {
      const unknown = options.find((o) => !['--hard', '--soft', '--mixed'].includes(o));
      if (unknown) return err({ type: 'UnknownOption', option: unknown, command: 'reset' });

      const target = positional[0];
      if (!target) {
        return err({ type: 'MissingArgument', command: 'reset', expected: '<commit>' });
      }
      return ok({
        kind: 'ability',
        command: { kind: 'reset', targetId: toCommitId(normalizeRef(target)) },
      });
    }

    case 'log':
      return ok({ kind: 'query', query: 'log' });
    case 'status':
      return ok({ kind: 'query', query: 'status' });
    case 'reflog':
      return ok({ kind: 'query', query: 'reflog' });
    case 'help':
      return ok({ kind: 'query', query: 'help' });

    default:
      return err({ type: 'UnknownCommand', command });
  }
};

/** 入力候補。コンソールの補完に使う。 */
export const COMMAND_HINTS: readonly { readonly usage: string; readonly summary: string }[] = [
  { usage: 'git log', summary: '世界線の履歴を見る' },
  { usage: 'git status', summary: '現在地と世界の状態を見る' },
  { usage: 'git branch', summary: '世界線の一覧を見る' },
  { usage: 'git checkout <branch>', summary: '観測する世界線を移す' },
  { usage: 'git revert <commit>', summary: '出来事を打ち消す（記録は残る）' },
  { usage: 'git merge <branch>', summary: '世界線を統合する' },
  { usage: 'git merge <branch> --theirs', summary: '矛盾を相手側で決着させる' },
  { usage: 'git branch <name> [<commit>]', summary: '世界線を分岐させる' },
  { usage: 'git reset <commit>', summary: '時点ごと巻き戻す（歴史が消える）' },
  { usage: 'git reflog', summary: '消えた世界線の記録を辿る' },
];
