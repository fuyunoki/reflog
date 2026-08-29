/**
 * content/lexicon/*.json を読む。
 *
 * ステージと同じくビルド時に取り込むので、配信は静的ファイルだけで完結する。
 * 既読はこの端末にしか持たない。読み物の既読を account に同期する必要はない。
 */
import type { LexiconEntry } from '@reflog/core';

const modules = import.meta.glob<LexiconEntry>('../../../../content/lexicon/*.json', {
  eager: true,
  import: 'default',
});

const entries: LexiconEntry[] = Object.values(modules);
const byId = new Map(entries.map((entry) => [entry.id, entry]));

const SEEN_KEY = 'reflog:lexicon:seen';

const loadSeen = (): Set<string> => {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
  } catch {
    // 既読が壊れていても、もう一度出るだけで害はない
    return new Set();
  }
};

export class StaticLexiconSource {
  private seen = loadSeen();

  get all(): readonly LexiconEntry[] {
    return entries;
  }

  get(id: string): LexiconEntry | undefined {
    return byId.get(id);
  }

  hasSeen(id: string): boolean {
    return this.seen.has(id);
  }

  markSeen(ids: readonly string[]): void {
    for (const id of ids) this.seen.add(id);
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...this.seen]));
    } catch {
      // 保存できなくても読めることのほうが大事
    }
  }
}

export const lexiconSource = new StaticLexiconSource();
