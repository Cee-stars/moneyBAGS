/*
  記録の集計。docs/PLAN.md §4.3

  家計簿の本体は「入れた記録を読み返せること」。ここは全部純粋関数にして、
  画面がなくても確かめられるようにしてある。

  方針:
  ・数えない日と 0円 の日は別もの。記録がない日は行を作らない
    （「¥0」と「未記録」を同じ見た目にしない・§1.3）。
  ・並びは新しい日が上。今日入れたものをすぐ確認できるほうが使う。
  ・同じ日の中は入れた順（createdAt）。あとから入れたものが下に積まれるほうが、
    入力直後にどれが自分の記録か分かりやすい。
*/

import type { Txn } from "./db.ts";
import { CATEGORIES, UNCATEGORIZED_LABEL } from "./categories.ts";
import { daysInMonth, parseISODate, toISODate } from "./recurrence.ts";

export type DayGroup = {
  date: string;
  /** その日の合計（最小単位） */
  totalMinor: number;
  items: Txn[];
};

/** 日ごとにまとめる。新しい日が先頭。 */
export function groupByDay(txns: readonly Txn[]): DayGroup[] {
  const byDate = new Map<string, Txn[]>();
  for (const t of txns) {
    const list = byDate.get(t.date);
    if (list) list.push(t);
    else byDate.set(t.date, [t]);
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([date, items]) => ({
      date,
      totalMinor: items.reduce((sum, t) => sum + t.amountMinor, 0),
      items: [...items].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    }));
}

export type CategoryTotal = {
  categoryId: string | null;
  name: string;
  totalMinor: number;
  count: number;
};

/*
  分類ごとの合計。多い順。
  分類を決めていない記録は消さずに最後へ置く。合計には必ず入れる
  （未分類でも合計は正しく出る、と画面で約束しているため）。
*/
export function categoryTotals(txns: readonly Txn[]): CategoryTotal[] {
  const acc = new Map<string, { total: number; count: number }>();
  for (const t of txns) {
    const key = t.categoryId ?? "";
    const cur = acc.get(key) ?? { total: 0, count: 0 };
    cur.total += t.amountMinor;
    cur.count += 1;
    acc.set(key, cur);
  }
  const rows: CategoryTotal[] = [...acc.entries()].map(([key, v]) => ({
    categoryId: key === "" ? null : key,
    name: key === "" ? UNCATEGORIZED_LABEL : (CATEGORIES.find((c) => c.id === key)?.name ?? "不明な分類"),
    totalMinor: v.total,
    count: v.count,
  }));
  rows.sort((a, b) => {
    // 未分類は中身の説明が無いので、金額に関わらず最後に置く
    if (a.categoryId === null) return 1;
    if (b.categoryId === null) return -1;
    return b.totalMinor - a.totalMinor;
  });
  return rows;
}

export function totalMinor(txns: readonly Txn[]): number {
  return txns.reduce((sum, t) => sum + t.amountMinor, 0);
}

/** 記録のある日の数。記録がない日は 0円 ではなく「数えない」。 */
export function recordedDayCount(txns: readonly Txn[]): number {
  return new Set(txns.map((t) => t.date)).size;
}

/*
  月を前後に動かす。日は1日に寄せる（31日の月から30日の月へ動かしたときに
  月が飛ぶのを防ぐ。lib/recurrence.ts のクランプと同じ理由）。
*/
export function shiftMonth(iso: string, delta: number): string {
  const { y, m } = parseISODate(iso);
  const total = y * 12 + (m - 1) + delta;
  return toISODate(Math.floor(total / 12), (total % 12) + 1, 1);
}

export function monthLabel(iso: string): string {
  const { y, m } = parseISODate(iso);
  return `${y}年${m}月`;
}

/** その月が今日より先かどうか。先の月へは進ませない。 */
export function isFutureMonth(iso: string, today: string): boolean {
  const a = parseISODate(iso);
  const b = parseISODate(today);
  return a.y * 12 + a.m > b.y * 12 + b.m;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

export function dayLabel(iso: string): string {
  const { y, m, d } = parseISODate(iso);
  return `${m}月${d}日（${WEEKDAYS[new Date(y, m - 1, d).getDay()]}）`;
}

/** その月の日数。画面で「30日のうち何日記録したか」を出すため。 */
export function daysInMonthOf(iso: string): number {
  const { y, m } = parseISODate(iso);
  return daysInMonth(y, m);
}
