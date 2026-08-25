/**
 * ログイン状態。
 *
 * ログインは「記録を持ち歩けるようにする」機能であって、遊ぶための条件ではない。
 * したがって、確認に失敗しても未ログインとして遊べる状態に落とすだけで、
 * 画面を止めることはしない。
 */
import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import type { AuthenticatedUser } from '@reflog/core';
import { authGateway, authErrorMessage } from '@/infrastructure/HttpAuthGateway';

export const useAuthStore = defineStore('auth', () => {
  const user = shallowRef<AuthenticatedUser | null>(null);
  const checking = ref(false);
  const checked = ref(false);
  const message = ref<string | null>(null);
  /** API が未配備の環境（開発中の vite dev など）では、ログイン導線を出さない。 */
  const available = ref(true);

  const signedIn = computed(() => user.value !== null);

  async function check(): Promise<void> {
    checking.value = true;
    const result = await authGateway.currentUser();
    checking.value = false;
    checked.value = true;

    if (result.ok) {
      user.value = result.value;
      available.value = true;
      return;
    }

    // /api が無い環境では未ログインのまま遊べればよい
    user.value = null;
    available.value = false;
  }

  /** コールバックが失敗して ?auth=... で戻ってきたときの取り込み。 */
  function consumeCallbackFlag(): void {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('auth');
    if (!code) return;

    message.value = authErrorMessage(code);
    url.searchParams.delete('auth');
    window.history.replaceState({}, '', url.toString());
  }

  function login(): void {
    authGateway.beginLogin();
  }

  async function logout(): Promise<void> {
    await authGateway.logout();
    user.value = null;
  }

  function dismissMessage(): void {
    message.value = null;
  }

  return {
    user,
    checking,
    checked,
    message,
    available,
    signedIn,
    check,
    consumeCallbackFlag,
    login,
    logout,
    dismissMessage,
  };
});
