/**
 * テスト専用のヘルパー。index.ts からは公開しない。
 * Result を assert で扱うと型が絞られないため、絞り込みごと行う関数を用意する。
 */
import type { Result } from './domain/shared/result.ts';

export const expectOk = <T, E>(r: Result<T, E>): T => {
  if (!r.ok) {
    throw new Error(`expected Ok but got Err: ${JSON.stringify(r.error)}`);
  }
  return r.value;
};

export const expectErr = <T, E extends { type: string }, K extends E['type']>(
  r: Result<T, E>,
  type: K,
): Extract<E, { type: K }> => {
  if (r.ok) {
    throw new Error(`expected Err(${type}) but got Ok`);
  }
  if (r.error.type !== type) {
    throw new Error(`expected Err(${type}) but got Err(${r.error.type})`);
  }
  return r.error as Extract<E, { type: K }>;
};
