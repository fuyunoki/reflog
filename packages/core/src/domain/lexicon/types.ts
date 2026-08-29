/**
 * 語彙カード —— 本文に出てくる人物・場所・用語の説明。
 *
 * 「世界観」と呼ばずに語彙集としたのは、WorldState（世界の事実）と紛れないため。
 * こちらは物語の側の資料であり、盤面の状態とは何の関係もない。
 *
 * 設定の一次資料は docs/world.md。ここはその配信形式にすぎない。
 */
import type { StageId } from '../stage/spec.ts';

export type LexiconKind =
  /** 人物。局の人間は片仮名の呼び名、局の外の人間は実名 */
  | 'person'
  /** 場所。実在しない和風の地名で揃える */
  | 'place'
  /** 観測局そのものと、その中の仕組み */
  | 'org'
  /** 局の用語。世界線・時点・因果負荷など */
  | 'term';

export interface LexiconEntry {
  readonly id: string;
  readonly kind: LexiconKind;
  /** 表示名。本文の照合にも使う */
  readonly name: string;
  /**
   * 本文中に現れる別表記。
   * 「霧島湊」と「霧島」の両方に下線を引きたい、といった場合に使う。
   */
  readonly aliases?: readonly string[];
  /** 一行の肩書き。カードの見出し下に出る */
  readonly caption: string;
  readonly lines: readonly string[];
  /**
   * 実務での対応。
   *
   * 役割・用語のカードには必ず書く。プレイヤーはエンジニアなので、
   * 架空の役職のままにしておくと何も想像できないため。
   * 逆に事案側（霧島湊、白鷺研究所など）には書かない。解説が挟まると事件の重みが落ちる。
   */
  readonly practice?: string;
  /**
   * 初出のステージ。
   * ここでだけ、導入を閉じた直後に自動で一度提示される。
   */
  readonly firstSeen?: StageId;
}

/**
 * 本文中で語を見つけた位置。
 * 表示側はこれを使って、地の文と押せる語に切り分ける。
 */
export interface LexiconMatch {
  readonly entryId: string;
  readonly start: number;
  readonly end: number;
}

/**
 * 本文を、地の文と語に切り分けたもの。
 * 表示側で分岐を書かずに済むよう、切れ目まで済ませて渡す。
 */
export type LexiconSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'entry'; readonly text: string; readonly entryId: string };
