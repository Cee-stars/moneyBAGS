import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupByDay,
  categoryTotals,
  totalMinor,
  recordedDayCount,
  shiftMonth,
  monthLabel,
  isFutureMonth,
  dayLabel,
  daysInMonthOf,
} from "./summary.ts";
import type { Txn } from "./db.ts";

const txn = (id: string, date: string, amountMinor: number, categoryId: string | null, createdAt: string): Txn => ({
  id,
  date,
  amountMinor,
  currency: "JPY",
  categoryId,
  memo: "",
  createdAt,
  updatedAt: createdAt,
});

const sample: Txn[] = [
  txn("a", "2026-10-28", 1280, "eatout", "2026-10-28T12:00:00Z"),
  txn("b", "2026-10-30", 450, "food", "2026-10-30T09:00:00Z"),
  txn("c", "2026-10-30", 3200, "food", "2026-10-30T19:00:00Z"),
  txn("d", "2026-10-30", 980, null, "2026-10-30T20:00:00Z"),
  txn("e", "2026-10-25", 7800, "hobby", "2026-10-25T10:00:00Z"),
];

test("日ごとにまとまり、新しい日が先頭に来る", () => {
  const days = groupByDay(sample);
  assert.deepEqual(
    days.map((d) => d.date),
    ["2026-10-30", "2026-10-28", "2026-10-25"],
  );
});

test("その日の合計が出る", () => {
  const days = groupByDay(sample);
  assert.equal(days[0].totalMinor, 450 + 3200 + 980);
  assert.equal(days[1].totalMinor, 1280);
});

test("同じ日の中は入れた順（あとから入れたものが下）", () => {
  const items = groupByDay(sample)[0].items;
  assert.deepEqual(items.map((t) => t.id), ["b", "c", "d"]);
});

test("記録がない日は行を作らない（0円の日と区別するため）", () => {
  // 10月なのに 3日分しか行がない。27日や29日の「0円の行」は作らない。
  assert.equal(groupByDay(sample).length, 3);
  assert.equal(groupByDay([]).length, 0);
});

test("分類ごとの合計は多い順。未分類は金額に関わらず最後", () => {
  const rows = categoryTotals(sample);
  assert.deepEqual(
    rows.map((r) => r.name),
    ["趣味", "食費", "外食", "あとで分類する"],
  );
  assert.equal(rows[0].totalMinor, 7800);
  assert.equal(rows[1].totalMinor, 450 + 3200);
  assert.equal(rows[1].count, 2);
});

test("未分類も合計に入る（未分類でも合計は正しい、と画面で約束しているため）", () => {
  const rows = categoryTotals(sample);
  const sum = rows.reduce((s, r) => s + r.totalMinor, 0);
  assert.equal(sum, totalMinor(sample));
  assert.equal(sum, 1280 + 450 + 3200 + 980 + 7800);
});

test("記録のある日数を数える（同じ日に何件入れても1日）", () => {
  assert.equal(recordedDayCount(sample), 3);
  assert.equal(recordedDayCount([]), 0);
});

test("月を前後に動かす。日数の違う月をまたいでも飛ばない", () => {
  assert.equal(shiftMonth("2026-10-31", -1), "2026-09-01");
  assert.equal(shiftMonth("2026-10-31", 1), "2026-11-01");
  assert.equal(shiftMonth("2026-01-15", -1), "2025-12-01");
  assert.equal(shiftMonth("2026-12-15", 1), "2027-01-01");
  // 12ヶ月分動かすと同じ月に戻る
  assert.equal(shiftMonth(shiftMonth("2026-03-10", -12), 12).slice(0, 7), "2026-03");
});

test("先の月かどうか", () => {
  assert.equal(isFutureMonth("2026-11-01", "2026-10-30"), true);
  assert.equal(isFutureMonth("2026-10-01", "2026-10-30"), false);
  // 同じ月は「先」ではない
  assert.equal(isFutureMonth("2026-10-31", "2026-10-01"), false);
  assert.equal(isFutureMonth("2025-12-01", "2026-01-01"), false);
});

test("表示用の文字", () => {
  assert.equal(monthLabel("2026-10-01"), "2026年10月");
  assert.equal(dayLabel("2026-10-30"), "10月30日（金）");
  assert.equal(daysInMonthOf("2026-02-10"), 28);
  assert.equal(daysInMonthOf("2028-02-10"), 29);
  assert.equal(daysInMonthOf("2026-10-01"), 31);
});
