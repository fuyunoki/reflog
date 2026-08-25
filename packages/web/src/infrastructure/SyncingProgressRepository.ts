/**
 * 端末とアカウントの両方に記録する。
 *
 * 未ログインでも遊べることを崩さないため、保存はまず端末に対して必ず行い、
 * アカウントへの同期は「できたらする」扱いにする。
 * 通信が落ちていても、遊びは止まらない。
 */
import type { PlayerId, PlayerProgress, ProgressRepository } from '@reflog/core';
import { emptyProgress } from '@reflog/core';
import { LocalStorageProgressRepository } from './LocalStorageProgressRepository';

interface ProgressResponse {
  readonly progress: PlayerProgress | null;
  readonly playerId: string;
}

export class RemoteProgressRepository implements ProgressRepository {
  async load(playerId: PlayerId): Promise<PlayerProgress> {
    const response = await fetch('/api/progress', { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`progress load failed: ${response.status}`);

    const body = (await response.json()) as ProgressResponse;
    if (!body.progress) return emptyProgress(body.playerId || playerId);

    return { ...emptyProgress(body.playerId), ...body.progress, playerId: body.playerId };
  }

  async save(progress: PlayerProgress): Promise<void> {
    const response = await fetch('/api/progress', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(progress),
    });
    if (!response.ok) throw new Error(`progress save failed: ${response.status}`);
  }
}

/**
 * 端末を正、アカウントを控えとして扱うリポジトリ。
 * ログインしていないときは端末だけで完結する。
 */
export class SyncingProgressRepository implements ProgressRepository {
  private readonly local = new LocalStorageProgressRepository();
  private readonly remote = new RemoteProgressRepository();

  constructor(private signedIn: () => boolean) {}

  async load(playerId: PlayerId): Promise<PlayerProgress> {
    if (this.signedIn()) {
      try {
        return await this.remote.load(playerId);
      } catch {
        // 通信できなければ端末の記録で続ける
      }
    }
    return this.local.load(playerId);
  }

  async save(progress: PlayerProgress): Promise<void> {
    // 端末への保存は必ず行う。ここが落ちると進行そのものが失われる。
    await this.local.save(progress);

    if (!this.signedIn()) return;
    try {
      await this.remote.save(progress);
    } catch {
      // 同期は次の保存で追いつくので、ここでは黙って諦める
    }
  }
}

export const remoteProgressRepository = new RemoteProgressRepository();
