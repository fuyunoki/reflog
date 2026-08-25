/**
 * 成功と失敗を型で表現する。例外を投げないことでドメイン層を純粋に保つ。
 */
export type Result<T, E> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok;

export const map = <T, U, E>(r: Result<T, E>, f: (value: T) => U): Result<U, E> =>
  r.ok ? ok(f(r.value)) : r;

export const flatMap = <T, U, E>(
  r: Result<T, E>,
  f: (value: T) => Result<U, E>,
): Result<U, E> => (r.ok ? f(r.value) : r);

/** テストやプロトタイプ用。失敗していたら例外を投げる。 */
export const unwrap = <T, E>(r: Result<T, E>): T => {
  if (!r.ok) {
    throw new Error(`unwrap on Err: ${JSON.stringify(r.error)}`);
  }
  return r.value;
};
