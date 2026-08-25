/**
 * コンソールに出す文字列の組み立て。
 *
 * 本物の git の出力に寄せる。ここで見慣れた形が実務でそのまま読めることに意味がある。
 * ただしコミットメッセージと事実は世界観の言葉で出す。
 */
import type {
  ParseError,
  QueryKind,
  StageSession,
  StageSpec,
  TimelineState,
} from '@reflog/core';
import {
  COMMAND_HINTS,
  branchesAt,
  currentWorldState,
  listCommits,
  recoverableCommits,
  resolveHead,
} from '@reflog/core';
import { factLabel, valueLabel } from './labels';

/**
 * 等幅フォントでも日本語は半角の 2 倍幅で表示されるため、
 * 文字数ではなく表示幅で揃える。
 */
const displayWidth = (text: string): number =>
  [...text].reduce(
    (width, char) => width + (/[ -ÿ｡-ﾟ]/.test(char) ? 1 : 2),
    0,
  );

const pad = (text: string, width: number): string => {
  const gap = width - displayWidth(text);
  return gap > 0 ? text + ' '.repeat(gap) : text;
};

/** git log --oneline に寄せた履歴。新しい順。 */
const renderLog = (state: TimelineState): string[] => {
  const head = resolveHead(state);
  const headId = head.ok ? head.value : null;

  return [...listCommits(state)]
    .sort((a, b) => b.sequence - a.sequence)
    .map((commit) => {
      const refs = branchesAt(state, commit.id);
      const decorations: string[] = [];
      if (commit.id === headId) {
        decorations.push(
          state.head.type === 'branch' ? `HEAD -> ${state.head.branch}` : 'HEAD',
        );
      }
      for (const ref of refs) {
        if (state.head.type === 'branch' && state.head.branch === ref) continue;
        decorations.push(ref);
      }
      const decoration = decorations.length > 0 ? ` (${decorations.join(', ')})` : '';
      return `${commit.id}${decoration} ${commit.message}`;
    });
};

const renderStatus = (session: StageSession): string[] => {
  const { timeline, spec } = session;
  const lines: string[] = [];

  lines.push(
    timeline.head.type === 'branch'
      ? `On branch ${timeline.head.branch}`
      : `HEAD detached at ${timeline.head.commitId}`,
  );

  const world = currentWorldState(timeline);
  if (world.ok) {
    const entries = Object.entries(world.value);
    const width = Math.max(...entries.map(([key]) => displayWidth(factLabel(spec, key))), 0);
    lines.push('', '世界の状態:');
    for (const [key, value] of entries) {
      lines.push(`  ${pad(factLabel(spec, key), width)}  ${valueLabel(spec, value)}`);
    }
  }

  lines.push('', '達成条件:');
  for (const status of session.report.statuses) {
    const mark = status.satisfied ? 'x' : ' ';
    const suffix = status.optional ? ' (任意)' : '';
    lines.push(`  [${mark}] ${status.label}${suffix}`);
  }

  const limits: string[] = [];
  if (spec.moveLimit !== undefined) {
    limits.push(`手数 ${session.movesUsed}/${spec.moveLimit}`);
  }
  if (spec.causalLoadLimit !== undefined) {
    limits.push(`因果負荷 ${session.causalLoad}/${spec.causalLoadLimit}`);
  }
  if (limits.length > 0) lines.push('', limits.join('　'));

  return lines;
};

const renderBranches = (state: TimelineState): string[] =>
  Object.entries(state.branches)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, tip]) => {
      const current = state.head.type === 'branch' && state.head.branch === name;
      return `${current ? '*' : ' '} ${pad(name, 18)} ${tip}`;
    });

const renderReflog = (state: TimelineState): string[] => {
  const lost = new Set(recoverableCommits(state));
  const lines = [...state.reflog]
    .sort((a, b) => b.sequence - a.sequence)
    .map((entry) => {
      const target = entry.after ?? entry.before ?? '-';
      const note = entry.note ? `: ${entry.note}` : '';
      const mark = lost.has(target) ? '  ← 到達不能' : '';
      return `${pad(target, 6)} HEAD@{${entry.sequence}} ${pad(entry.operation, 18)}${note}${mark}`;
    });

  if (lost.size > 0) {
    lines.push('', `どのブランチからも辿れない時点が ${lost.size} 件ある。`);
  }
  return lines;
};

const renderHelp = (spec: StageSpec): string[] => {
  const lines = ['使えるコマンド:'];
  for (const hint of COMMAND_HINTS) {
    lines.push(`  ${pad(hint.usage, 34)}${hint.summary}`);
  }
  lines.push(
    '',
    `このステージで行使できる能力: ${spec.abilities.join(', ')}`,
    '先頭の git は省略してもよい。',
  );
  return lines;
};

export const renderQuery = (query: QueryKind, session: StageSession): string[] => {
  switch (query) {
    case 'log':
      return renderLog(session.timeline);
    case 'status':
      return renderStatus(session);
    case 'branch':
      return renderBranches(session.timeline);
    case 'reflog':
      return renderReflog(session.timeline);
    case 'help':
      return renderHelp(session.spec);
  }
};

/** 解釈できなかったときの案内。何を打てばよいかまで書く。 */
export const parseErrorMessage = (error: ParseError): string => {
  switch (error.type) {
    case 'Empty':
      return '';
    case 'NotGit':
      return `${error.input}: そのようなコマンドはない。help と打つと一覧が出る。`;
    case 'UnknownCommand':
      return `git: '${error.command}' はこの端末では使えない。help と打つと一覧が出る。`;
    case 'MissingArgument':
      return `${error.command}: 引数が足りない。${error.expected} を指定する。`;
    case 'UnknownOption':
      return `${error.command}: 不明なオプション ${error.option}`;
    case 'TooManyArguments':
      return `${error.command}: 引数が多すぎる。`;
  }
};
