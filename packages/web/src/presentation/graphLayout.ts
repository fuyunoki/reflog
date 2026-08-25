/**
 * 世界線図のレイアウト計算。
 *
 * 描画から切り離した純粋関数にしてある。座標計算は目視では検証しづらいので、
 * テストできる形に保っておきたい。
 */
import type { BranchName, Commit, CommitId, TimelineState } from '@reflog/core';
import { branchesAt, listCommits, resolveHead } from '@reflog/core';

export interface GraphNode {
  readonly id: CommitId;
  readonly commit: Commit;
  readonly x: number;
  readonly y: number;
  readonly lane: number;
  readonly isHead: boolean;
  /** どのブランチからも辿れない＝消えた世界線。 */
  readonly isOrphan: boolean;
  readonly refs: readonly BranchName[];
  /**
   * ラベルを置く段。同じレーンで隣り合うノード同士を互い違いにして、
   * 長いメッセージが横に繋がって読めなくなるのを防ぐ。
   */
  readonly labelRow: 0 | 1;
}

export interface GraphEdge {
  readonly id: string;
  readonly path: string;
  /** マージの second parent。破線で描いて合流だと分かるようにする。 */
  readonly isSecondParent: boolean;
}

export interface GraphLayout {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly width: number;
  readonly height: number;
  readonly radius: number;
}

export interface LayoutOptions {
  readonly originX?: number;
  readonly originY?: number;
  readonly stepX?: number;
  readonly stepY?: number;
  readonly radius?: number;
}

/**
 * ブランチごとにレーン（縦位置）を割り当てる。
 * 各ブランチの先端から first-parent を辿り、未割り当てのコミットを埋めていく。
 * main を必ず最上段に置くことで、図の読み方が毎回同じになる。
 */
const assignLanes = (state: TimelineState): Record<CommitId, number> => {
  const lanes: Record<CommitId, number> = {};
  const names = Object.keys(state.branches).sort((a, b) => {
    if (a === 'main') return -1;
    if (b === 'main') return 1;
    return a.localeCompare(b);
  });

  names.forEach((name, index) => {
    let cursor: CommitId | undefined = state.branches[name];
    while (cursor && !(cursor in lanes)) {
      lanes[cursor] = index;
      cursor = state.commits[cursor]?.parents[0];
    }
  });

  // 到達不能なコミット（reset で切り離されたもの）は最下段にまとめる
  let orphanLane = names.length;
  for (const id of Object.keys(state.commits)) {
    if (!(id in lanes)) {
      lanes[id] = orphanLane;
      orphanLane += 1;
    }
  }
  return lanes;
};

const reachableSet = (state: TimelineState): ReadonlySet<CommitId> => {
  const reachable = new Set<CommitId>();
  const walk = (start: CommitId | undefined): void => {
    const queue: CommitId[] = start ? [start] : [];
    while (queue.length > 0) {
      const current = queue.shift() as CommitId;
      if (reachable.has(current)) continue;
      const commit = state.commits[current];
      if (!commit) continue;
      reachable.add(current);
      queue.push(...commit.parents);
    }
  };
  for (const tip of Object.values(state.branches)) walk(tip);
  if (state.head.type === 'detached') walk(state.head.commitId);
  return reachable;
};

export const layoutTimeline = (
  state: TimelineState,
  options: LayoutOptions = {},
): GraphLayout => {
  const originX = options.originX ?? 74;
  const originY = options.originY ?? 62;
  const stepX = options.stepX ?? 148;
  const stepY = options.stepY ?? 108;
  const radius = options.radius ?? 11;

  const lanes = assignLanes(state);
  const commits = listCommits(state);
  const reachable = reachableSet(state);
  const head = resolveHead(state);
  const headId = head.ok ? head.value : null;

  const positions: Record<CommitId, { x: number; y: number }> = {};
  const laneSeen: Record<number, number> = {};

  const nodes: GraphNode[] = commits.map((commit, index) => {
    const lane = lanes[commit.id] ?? 0;
    const x = originX + index * stepX;
    const y = originY + lane * stepY;
    positions[commit.id] = { x, y };

    const seen = (laneSeen[lane] ?? -1) + 1;
    laneSeen[lane] = seen;

    return {
      id: commit.id,
      commit,
      x,
      y,
      lane,
      isHead: commit.id === headId,
      isOrphan: !reachable.has(commit.id),
      refs: branchesAt(state, commit.id),
      labelRow: (seen % 2) as 0 | 1,
    };
  });

  const edges: GraphEdge[] = [];
  for (const commit of commits) {
    commit.parents.forEach((parentId, index) => {
      const from = positions[parentId];
      const to = positions[commit.id];
      if (!from || !to) return;

      const path =
        from.y === to.y
          ? `M ${from.x + radius} ${from.y} L ${to.x - radius} ${to.y}`
          : `M ${from.x + radius} ${from.y} ` +
            `C ${from.x + stepX * 0.55} ${from.y}, ` +
            `${to.x - stepX * 0.55} ${to.y}, ${to.x - radius} ${to.y}`;

      edges.push({
        id: `${parentId}->${commit.id}`,
        path,
        isSecondParent: index > 0,
      });
    });
  }

  const maxLane = nodes.reduce((max, node) => Math.max(max, node.lane), 0);
  return {
    nodes,
    edges,
    width: Math.max(originX + stepX * Math.max(1, commits.length - 1) + 190, 560),
    height: originY + stepY * maxLane + 130,
    radius,
  };
};
