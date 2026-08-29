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
export type QueryKind = 'log' | 'status' | 'branch' | 'tag' | 'reflog' | 'help';

export type ConsoleAction =
  | { readonly kind: 'ability'; readonly command: AbilityCommand }
  /**
   * commit は「何を刻むか」がステージ側の候補で決まるので、
   * ここでは意図だけ返し、実際の内容は呼び出し側で解決する。
   */
  | { readonly kind: 'commit'; readonly offerId?: string }
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
  /** merge と同じく、矛盾が出るかは実行してみないと分からない。 */
  | {
      readonly kind: 'rebase';
      readonly onto: BranchName;
      readonly strategy: 'ask' | 'ours' | 'theirs';
    }
  | { readonly kind: 'query'; readonly query: QueryKind }
  /** 2 つの時点を見比べる。引数の数で何と何を比べるかが変わる。 */
  | {
      readonly kind: 'diff';
      readonly from?: CommitId;
      readonly to?: CommitId;
    };

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
  'commit',
  'diff',
  'revert',
  'cherry-pick',
  'merge',
  'rebase',
  'checkout',
  'switch',
  'branch',
  'tag',
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
    case 'commit': {
      const unknown = options.find((o) => o !== '-m');
      if (unknown) return err({ type: 'UnknownOption', option: unknown, command: 'commit' });
      // 引数があれば候補の指定として扱う（無ければ候補が 1 つのときだけ通る）
      return ok(positional[0] ? { kind: 'commit', offerId: positional[0] } : { kind: 'commit' });
    }

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

    case 'cherry-pick': {
      const target = positional[0];
      if (!target) {
        return err({ type: 'MissingArgument', command: 'cherry-pick', expected: '<commit>' });
      }
      if (positional.length > 1) {
        return err({ type: 'TooManyArguments', command: 'cherry-pick' });
      }
      return ok({
        kind: 'ability',
        command: { kind: 'cherry-pick', targetId: toCommitId(normalizeRef(target)) },
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

    case 'rebase': {
      const onto = positional[0];
      if (!onto) {
        return err({ type: 'MissingArgument', command: 'rebase', expected: '<branch>' });
      }
      let strategy: 'ask' | 'ours' | 'theirs' = 'ask';
      for (const option of options) {
        if (option === '--ours') strategy = 'ours';
        else if (option === '--theirs') strategy = 'theirs';
        else return err({ type: 'UnknownOption', option, command: 'rebase' });
      }
      return ok({ kind: 'rebase', onto: normalizeRef(onto), strategy });
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

    case 'tag': {
      const deleting = options.includes('-d') || options.includes('--delete');
      const unknown = options.find((o) => !['-d', '--delete', '-a', '-l', '--list'].includes(o));
      if (unknown) return err({ type: 'UnknownOption', option: unknown, command: 'tag' });

      if (deleting) {
        const name = positional[0];
        if (!name) {
          return err({ type: 'MissingArgument', command: 'tag -d', expected: '<name>' });
        }
        return ok({ kind: 'ability', command: { kind: 'delete-tag', name: normalizeRef(name) } });
      }

      // 引数なしは一覧
      if (positional.length === 0) return ok({ kind: 'query', query: 'tag' });

      const name = normalizeRef(positional[0] as string);
      const at = positional[1];
      return ok({
        kind: 'ability',
        command: at
          ? { kind: 'tag', name, at: toCommitId(normalizeRef(at)) }
          : { kind: 'tag', name },
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

    case 'diff': {
      if (positional.length > 2) return err({ type: 'TooManyArguments', command: 'diff' });
      const [from, to] = positional;
      return ok({
        kind: 'diff',
        ...(from ? { from: toCommitId(normalizeRef(from)) } : {}),
        ...(to ? { to: toCommitId(normalizeRef(to)) } : {}),
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
  { usage: 'git diff <a> <b>', summary: '二つの時点を見比べる' },
  { usage: 'git status', summary: '現在地と世界の状態を見る' },
  { usage: 'git branch', summary: '世界線の一覧を見る' },
  { usage: 'git checkout <branch>', summary: '観測する世界線を移す' },
  { usage: 'git commit', summary: '新しい出来事を刻む' },
  { usage: 'git revert <commit>', summary: '出来事を打ち消す（記録は残る）' },
  { usage: 'git merge <branch>', summary: '世界線を統合する' },
  { usage: 'git merge <branch> --theirs', summary: '矛盾を相手側で決着させる' },
  { usage: 'git rebase <branch>', summary: '出来事を別の世界線の上に並べ直す' },
  { usage: 'git cherry-pick <commit>', summary: '別の世界線の出来事を 1 つだけ持ち込む' },
  { usage: 'git branch <name> [<commit>]', summary: '世界線を分岐させる' },
  { usage: 'git tag <name> [<commit>]', summary: '時点に動かない印を付ける' },
  { usage: 'git reset <commit>', summary: '時点ごと巻き戻す（歴史が消える）' },
  { usage: 'git reflog', summary: '消えた世界線の記録を辿る' },
];
