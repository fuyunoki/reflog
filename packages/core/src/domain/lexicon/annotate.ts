/**
 * 本文から登録語を見つけて、押せる語に切り分ける。
 *
 * 本文の側に印を書かせない方針を取っている。
 * ステージ JSON は物語を書く場所であって、リンクを張る場所ではないため。
 * 語彙を 1 つ足せば、過去に書いた全ステージの本文に自動で反映される。
 */
import type { LexiconEntry, LexiconMatch, LexiconSegment } from './types.ts';

/** 照合に使う表記を、長いものから順に並べる。 */
interface Needle {
  readonly entryId: string;
  readonly text: string;
}

const needlesOf = (entries: readonly LexiconEntry[]): readonly Needle[] =>
  entries
    .flatMap((entry) =>
      [entry.name, ...(entry.aliases ?? [])].map((text) => ({ entryId: entry.id, text })),
    )
    .filter((n) => n.text.length > 0)
    // 「霧島湊」と「霧島」が両方登録されている場合、長い方を先に当てる
    .sort((a, b) => b.text.length - a.text.length);

/**
 * 本文中の登録語の位置を返す。重なりは長い語を優先し、短い方は捨てる。
 */
export const findMatches = (
  text: string,
  entries: readonly LexiconEntry[],
): readonly LexiconMatch[] => {
  const taken: boolean[] = new Array(text.length).fill(false);
  const matches: LexiconMatch[] = [];

  for (const needle of needlesOf(entries)) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(needle.text, from);
      if (at < 0) break;
      const end = at + needle.text.length;

      let free = true;
      for (let i = at; i < end; i += 1) {
        if (taken[i]) {
          free = false;
          break;
        }
      }
      if (free) {
        for (let i = at; i < end; i += 1) taken[i] = true;
        matches.push({ entryId: needle.entryId, start: at, end });
      }
      from = end;
    }
  }

  return matches.sort((a, b) => a.start - b.start);
};

/**
 * 本文を、地の文と押せる語の列に切り分ける。
 *
 * `once` を渡すと、同じ語に何度も下線を引かない。
 * 一段落の中で同じ名前が三度出るたびに下線が引かれると、本文が読めなくなるため。
 */
export const annotate = (
  text: string,
  entries: readonly LexiconEntry[],
  once?: Set<string>,
): readonly LexiconSegment[] => {
  const matches = findMatches(text, entries);
  if (matches.length === 0) return [{ kind: 'text', text }];

  const out: LexiconSegment[] = [];
  let cursor = 0;

  for (const match of matches) {
    if (once?.has(match.entryId)) continue;
    once?.add(match.entryId);

    if (match.start > cursor) {
      out.push({ kind: 'text', text: text.slice(cursor, match.start) });
    }
    out.push({
      kind: 'entry',
      text: text.slice(match.start, match.end),
      entryId: match.entryId,
    });
    cursor = match.end;
  }

  if (cursor < text.length) out.push({ kind: 'text', text: text.slice(cursor) });
  return out;
};

/** そのステージで初めて出る語。導入を閉じた直後に一度だけ提示する。 */
export const debutsIn = (
  stageId: string,
  entries: readonly LexiconEntry[],
): readonly LexiconEntry[] => entries.filter((entry) => entry.firstSeen === stageId);
