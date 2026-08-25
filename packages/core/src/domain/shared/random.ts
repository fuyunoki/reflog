/**
 * 決定的な擬似乱数。
 *
 * 同じ seed からは必ず同じステージが生成される。これにより
 * 「任務 #4471 をやってみて」と seed を共有するだけでステージを再現でき、
 * サーバにステージ本体を保存する必要がなくなる。
 *
 * core は依存ゼロを保つため、mulberry32 を自前で持つ。
 */
export interface Rng {
  /** 0 以上 1 未満。 */
  next(): number;
  /** min 以上 max 以下の整数。 */
  int(min: number, max: number): number;
  /** 配列から 1 つ選ぶ。 */
  pick<T>(items: readonly T[]): T;
  /** 配列から重複なく n 個選ぶ。 */
  sample<T>(items: readonly T[], n: number): T[];
  /** 確率 p で true。 */
  chance(p: number): boolean;
}

export const createRng = (seed: number): Rng => {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number =>
    min + Math.floor(next() * (max - min + 1));

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error('pick from empty array');
    return items[int(0, items.length - 1)] as T;
  };

  const sample = <T>(items: readonly T[], n: number): T[] => {
    const pool = [...items];
    const out: T[] = [];
    while (out.length < n && pool.length > 0) {
      out.push(pool.splice(int(0, pool.length - 1), 1)[0] as T);
    }
    return out;
  };

  return { next, int, pick, sample, chance: (p) => next() < p };
};

/** 文字列から seed を作る。任務番号やユーザー名からステージを決めるのに使う。 */
export const seedFrom = (text: string): number => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};
