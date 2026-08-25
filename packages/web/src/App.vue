<script setup lang="ts">
/**
 * 画面の切り替えと、入口の説明。
 *
 * ルーターは入れていない。画面が 2 つしかない今の段階では、
 * 状態ひとつで足りるものに依存を増やす理由がないため。
 *
 * ホームでは、まず「これが何をする遊びなのか」を短く言い切る。
 * 世界観の説明から入ると、初見のプレイヤーは自分が何を求められているのか分からない。
 */
import { computed, onMounted, ref } from 'vue';
import type { GeneratedStage, StageSpec } from '@reflog/core';
import { DIFFICULTIES, countsAsMove } from '@reflog/core';
import { useProgressStore } from '@/stores/progress';
import { useSessionStore } from '@/stores/session';
import { useAuthStore } from '@/stores/auth';
import { stageSource } from '@/infrastructure/StaticStageSource';
import StageView from '@/presentation/views/StageView.vue';

type Screen = 'home' | 'stage';

const progress = useProgressStore();
const session = useSessionStore();
const auth = useAuthStore();

const screen = ref<Screen>('home');
const current = ref<StageSpec | null>(null);
/** 観測任務のときだけ入る。想定解の手数を成績評価に使う。 */
const currentMission = ref<GeneratedStage | null>(null);
const glossaryOpen = ref(false);

/** 章ごとにまとめる。0 章は訓練として扱う。 */
const chapters = computed(() => {
  const grouped = new Map<number, { number: number; title: string; stages: StageSpec[] }>();
  for (const spec of stageSource.all) {
    const entry = grouped.get(spec.chapter.number) ?? {
      number: spec.chapter.number,
      title: spec.chapter.title,
      stages: [],
    };
    entry.stages.push(spec);
    grouped.set(spec.chapter.number, entry);
  }
  return [...grouped.values()]
    .map((chapter) => ({
      ...chapter,
      stages: [...chapter.stages].sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => a.number - b.number);
});

const difficultyLabel = computed(() => DIFFICULTIES[progress.difficulty].label);

/** まだ 1 つもクリアしていないなら、最初のステージへ誘導する。 */
const firstUncleared = computed<StageSpec | null>(() => {
  for (const chapter of chapters.value) {
    for (const spec of chapter.stages) {
      if (!progress.isCleared(spec.id)) return spec;
    }
  }
  return null;
});

const isNewcomer = computed(() => progress.clearedCount === 0);

onMounted(async () => {
  auth.consumeCallbackFlag();
  await auth.check();

  if (auth.signedIn) await progress.mergeWithAccount();
  else await progress.load();
});

const openStage = (spec: StageSpec): void => {
  currentMission.value = null;
  current.value = spec;
  screen.value = 'stage';
};

const drawMission = (): void => {
  const mission = progress.drawMission();
  if (!mission) {
    session.notify('任務の生成に失敗した。もう一度試してほしい。', 'error');
    return;
  }
  currentMission.value = mission;
  current.value = mission.spec;
  screen.value = 'stage';
};

const onCleared = async (): Promise<void> => {
  const spec = current.value;
  const played = session.session;
  if (!spec || !played) return;

  if (currentMission.value) {
    const expected = currentMission.value.solution.filter(countsAsMove).length;
    await progress.recordMissionResult({
      cleared: true,
      moveOverhead: played.movesUsed - expected,
      usedHint: session.usedHint,
      retries: session.retries,
    });
  } else {
    await progress.recordClear(spec.id, played);
  }
};

const onNext = (): void => {
  if (currentMission.value) {
    drawMission();
    return;
  }
  screen.value = 'home';
  current.value = null;
};

const exit = (): void => {
  screen.value = 'home';
  current.value = null;
  currentMission.value = null;
};
</script>

<template>
  <StageView
    v-if="screen === 'stage' && current"
    :spec="current"
    @cleared="onCleared"
    @next="onNext"
    @exit="exit"
  />

  <main v-else class="home">
    <header class="masthead">
      <h1 class="wordmark">REFLOG</h1>
      <p class="tagline jp">git の操作で、壊れてしまった歴史を直すパズル。</p>
    </header>

    <!-- 何をする遊びなのかを、世界観より先に言う -->
    <section class="pitch">
      <p class="jp">
        あなたは<strong>世界線修正官</strong>。過去の記録を書き換えて、あるべき世界を取り戻す。
      </p>
      <p class="jp">
        使う道具は <code>revert</code>、<code>merge</code>、<code>reset</code> ——
        すべて実在する git のコマンドで、意味も本物と同じ。遊んでいるうちに身につく。
      </p>

      <button
        class="glossary-toggle"
        type="button"
        :aria-expanded="glossaryOpen"
        @click="glossaryOpen = !glossaryOpen"
      >
        {{ glossaryOpen ? '−' : '+' }} 言葉の対応を見る
      </button>

      <dl v-if="glossaryOpen" class="glossary">
        <div><dt>時点</dt><dd>コミット。その瞬間に何が起きたかの記録</dd></div>
        <div><dt>世界線</dt><dd>ブランチ。枝分かれした歴史の一本</dd></div>
        <div><dt>統合</dt><dd>マージ。二本の世界線を一つに束ねる</dd></div>
        <div><dt>打ち消し</dt><dd>revert。出来事の影響だけを消す。記録は残る</dd></div>
        <div><dt>巻き戻し</dt><dd>reset。時点ごと歴史を消す。危険</dd></div>
        <div><dt>矛盾</dt><dd>コンフリクト。両立しない二つの現実</dd></div>
      </dl>
    </section>

    <section v-if="isNewcomer && firstUncleared" class="start">
      <button class="btn primary big" type="button" @click="openStage(firstUncleared)">
        はじめる — {{ firstUncleared.title }}
      </button>
      <span class="label">操作は最初のステージで一つずつ教える</span>
    </section>

    <section v-for="chapter in chapters" :key="chapter.number" class="block">
      <div class="block-head">
        <span class="label">
          {{ chapter.number === 0 ? '訓練' : `第 ${chapter.number} 章` }} — {{ chapter.title }}
        </span>
        <span class="label">
          {{ chapter.stages.filter((s) => progress.isCleared(s.id)).length }} /
          {{ chapter.stages.length }}
        </span>
      </div>
      <div class="list">
        <button
          v-for="spec in chapter.stages"
          :key="spec.id"
          class="entry"
          type="button"
          @click="openStage(spec)"
        >
          <span class="entry-no">{{ spec.id.toUpperCase() }}</span>
          <span class="entry-main">
            <span class="entry-title jp">{{ spec.title }}</span>
            <span class="entry-sub jp">{{ spec.intro[0] ?? '' }}</span>
          </span>
          <span class="entry-state" :class="{ done: progress.isCleared(spec.id) }">
            {{ progress.isCleared(spec.id) ? '修正済み' : '未修正' }}
          </span>
        </button>
      </div>
    </section>

    <section class="block">
      <div class="block-head">
        <span class="label">観測任務</span>
        <span class="label">{{ difficultyLabel }}</span>
      </div>
      <p class="note jp">
        観測局から配信される異常。番号と警戒度から自動で組まれるので、尽きることがない。
        成績に応じて警戒度が上下する。
      </p>
      <button class="btn primary mission" type="button" @click="drawMission">
        任務 #{{ progress.missionNumber }} を受領する
      </button>
    </section>

    <section class="block account">
      <div class="block-head">
        <span class="label">記録</span>
      </div>

      <template v-if="!auth.available">
        <p class="note jp">記録はこの端末に保存されている。</p>
      </template>

      <template v-else-if="auth.signedIn && auth.user">
        <p class="note jp">
          <strong>{{ auth.user.username }}</strong> としてログイン中。
          記録はアカウントに保存され、別の端末でも続きから遊べる。
        </p>
        <button class="btn" type="button" @click="auth.logout()">ログアウト</button>
      </template>

      <template v-else>
        <p class="note jp">
          記録はこの端末に保存されている。GitHub でログインすると、別の端末でも続きから遊べる。
          この端末で遊んだ分は、ログイン時にそのまま引き継がれる。
        </p>
        <button class="btn" type="button" :disabled="auth.checking" @click="auth.login()">
          GitHub でログイン
        </button>
      </template>

      <p v-if="auth.message" class="auth-message jp">
        {{ auth.message }}
        <button class="link" type="button" @click="auth.dismissMessage()">閉じる</button>
      </p>
    </section>
  </main>
</template>

<style scoped>
.home {
  min-height: 100dvh;
  max-width: 720px;
  margin: 0 auto;
  padding: clamp(24px, 6vw, 72px) 20px 48px;
  display: flex;
  flex-direction: column;
  gap: 30px;
}

.masthead {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.wordmark {
  font-family: var(--sans);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: -0.03em;
  line-height: 1;
  font-size: clamp(44px, 13vw, 108px);
  margin: 0;
  color: var(--ink);
}

.tagline {
  margin: 0;
  color: var(--ink-muted);
  font-size: 13px;
  line-height: 1.8;
  max-width: 46ch;
}

.pitch {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-left: 3px solid var(--accent);
  padding: 4px 0 4px 14px;
}

.pitch p {
  margin: 0;
  font-size: 13px;
  line-height: 1.85;
  max-width: 52ch;
  color: var(--ink);
}

.pitch code {
  font-family: var(--mono);
  font-size: 12px;
  background: var(--panel);
  padding: 1px 5px;
}

.glossary-toggle {
  align-self: flex-start;
  background: none;
  border: none;
  padding: 4px 0;
  cursor: pointer;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-muted);
  letter-spacing: 0.02em;
}
.glossary-toggle:hover {
  color: var(--ink);
}
.glossary-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.glossary {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--rule);
  border: 1px solid var(--rule);
}
.glossary > div {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  gap: 12px;
  background: var(--panel);
  padding: 7px 10px;
}
.glossary dt {
  font-size: 12px;
  font-weight: 700;
}
.glossary dd {
  margin: 0;
  font-size: 12px;
  color: var(--ink-muted);
  line-height: 1.6;
}

.start {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}

.btn.big {
  font-size: 13px;
  padding: 13px 20px;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.block-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  border-bottom: 1px solid var(--rule-firm);
  padding-bottom: 6px;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--rule);
}

.entry {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  text-align: left;
  background: var(--panel);
  border: none;
  border-radius: 0;
  padding: 13px 14px;
  cursor: pointer;
  color: var(--ink);
  transition: background 120ms linear;
}
.entry:hover {
  background: var(--panel-hi);
}
.entry:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.entry-no {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--ink-faint);
  letter-spacing: 0.04em;
}

.entry-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.entry-title {
  font-size: 14px;
  font-weight: 500;
}

.entry-sub {
  font-size: 11px;
  color: var(--ink-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-state {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--ink-faint);
  white-space: nowrap;
}
.entry-state.done {
  color: var(--ok);
}

.note {
  margin: 0;
  font-size: 12px;
  line-height: 1.75;
  color: var(--ink-muted);
  max-width: 52ch;
}

.mission {
  align-self: flex-start;
  font-family: var(--mono);
  font-size: 12px;
}

.account {
  margin-top: auto;
  padding-top: 8px;
}
.account .btn {
  align-self: flex-start;
}

.auth-message {
  margin: 0;
  font-size: 12px;
  color: var(--accent);
  display: flex;
  gap: 10px;
  align-items: baseline;
}

.link {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-size: 11px;
  color: var(--ink-muted);
  text-decoration: underline;
}

@media (max-width: 620px) {
  .entry {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
  }
  .entry-no {
    display: none;
  }
}
</style>
