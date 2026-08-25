/**
 * content/stages/*.json を読む StageSource の実装。
 *
 * ビルド時に取り込むので、配信は静的ファイルのみで完結する。
 * 将来サーバから配信したくなっても、差し替えるのはこのクラスだけで済む。
 */
import type {
  LoadError,
  Result,
  StageId,
  StageSource,
  StageSpec,
  StageSummary,
} from '@reflog/core';
import { ok, err } from '@reflog/core';

const modules = import.meta.glob<StageSpec>('../../../../content/stages/*.json', {
  eager: true,
  import: 'default',
});

const stages: Record<StageId, StageSpec> = {};
for (const spec of Object.values(modules)) {
  stages[spec.id] = spec;
}

export class StaticStageSource implements StageSource {
  async list(): Promise<readonly StageSummary[]> {
    return Object.values(stages)
      .map((spec) => ({
        id: spec.id,
        title: spec.title,
        chapterNumber: spec.chapter.number,
      }))
      .sort((a, b) => a.chapterNumber - b.chapterNumber || a.id.localeCompare(b.id));
  }

  async get(id: StageId): Promise<Result<StageSpec, LoadError>> {
    const spec = stages[id];
    return spec ? ok(spec) : err({ type: 'NotFound', id });
  }

  /** 同期で引きたい場面（初期表示）のための補助。 */
  getSync(id: StageId): StageSpec | undefined {
    return stages[id];
  }

  get all(): readonly StageSpec[] {
    return Object.values(stages);
  }
}

export const stageSource = new StaticStageSource();
