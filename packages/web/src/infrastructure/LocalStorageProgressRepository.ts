/**
 * 未ログイン時の進捗保存。
 *
 * ログインするとこの実装が D1 版に差し替わるが、ドメインからは同じポートに見える。
 * 差し替えは合成ルート（main.ts）だけの仕事になる。
 */
import type { PlayerId, PlayerProgress, ProgressRepository } from '@reflog/core';
import { emptyProgress } from '@reflog/core';

/**
 * 端末側の保存キーは 1 つに固定する。
 * ログインの前後で持ち主（playerId）は変わるが、この端末で遊んだ記録は 1 本であり、
 * キーを分けると統合前の記録が迷子になるため。
 */
const STORAGE_KEY = 'reflog:progress:local';

/** 端末に固定の匿名 ID。ログインするまではこれが記録の持ち主。 */
export const LOCAL_PLAYER_ID = 'local';

export class LocalStorageProgressRepository implements ProgressRepository {
  async load(playerId: PlayerId): Promise<PlayerProgress> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyProgress(playerId);

      const parsed = JSON.parse(raw) as PlayerProgress;
      // 保存形式が古い場合に備えて、欠けている項目を補う
      return {
        ...emptyProgress(playerId),
        ...parsed,
        playerId: parsed.playerId ?? playerId,
      };
    } catch {
      // 壊れた保存データで遊べなくなるより、初期状態から再開できる方がよい
      return emptyProgress(playerId);
    }
  }

  async save(progress: PlayerProgress): Promise<void> {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch {
      // 容量超過やプライベートモードでも、進行そのものは止めない
    }
  }
}

export const progressRepository = new LocalStorageProgressRepository();
