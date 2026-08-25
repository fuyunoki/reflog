/**
 * Pages Functions 越しの認証。
 *
 * トークンは HttpOnly Cookie に入っており、この層からも読めない。
 * ここが知っているのは「ログインしているか」と「誰か」だけで十分。
 */
import type { AuthenticatedUser, AuthError, AuthGateway, Result } from '@reflog/core';
import { ok, err } from '@reflog/core';

interface MeResponse {
  readonly user: {
    readonly playerId: string;
    readonly username: string;
    readonly avatarUrl: string | null;
  } | null;
}

export class HttpAuthGateway implements AuthGateway {
  async currentUser(): Promise<Result<AuthenticatedUser | null, AuthError>> {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!response.ok) {
        return err({ type: 'NetworkError', reason: `HTTP ${response.status}` });
      }
      const body = (await response.json()) as MeResponse;
      return ok(body.user);
    } catch (cause) {
      return err({ type: 'NetworkError', reason: String(cause) });
    }
  }

  beginLogin(): void {
    // サーバが state を発行して GitHub へ送り出す。戻り先はトップ。
    window.location.href = '/api/auth/login';
  }

  async logout(): Promise<void> {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {
      // 失敗してもクライアント側の状態は落とす
    }
  }
}

export const authGateway = new HttpAuthGateway();

/** コールバックが失敗したときに ?auth=... で戻ってくる。その理由を文にする。 */
export const authErrorMessage = (code: string): string => {
  switch (code) {
    case 'cancelled':
      return 'ログインを取りやめた。';
    case 'bad_state':
      return '認証の照合に失敗した。もう一度試してほしい。';
    case 'no_code':
    case 'exchange_failed':
      return 'GitHub との認証に失敗した。';
    case 'user_fetch_failed':
      return 'GitHub からアカウント情報を取得できなかった。';
    default:
      return 'ログインできなかった。';
  }
};
