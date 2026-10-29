import { test } from "node:test";
import assert from "node:assert/strict";
import {
  occurrenceOn,
  nextOccurrenceOnOrAfter,
  annualizedMinor,
  monthlyEquivalentMinor,
  daysInMonth,
} from "./recurrence.ts";

const monthly31 = { anchorDate: "2027-01-31", freq: "MONTH" as const, intervalN: 1 };

test("31日課金はクランプし、長い月で31日に戻る（一番間違えやすい箇所）", () => {
  assert.equal(occurrenceOn(monthly31, 0), "2027-01-31");
  assert.equal(occurrenceOn(monthly31, 1), "2027-02-28");
  // ここが肝。クランプ後を保存すると28日のままになり、二度と戻らない。
  assert.equal(occurrenceOn(monthly31, 2), "2027-03-31");
  assert.equal(occurrenceOn(monthly31, 3), "2027-04-30");
  assert.equal(occurrenceOn(monthly31, 4), "2027-05-31");
});

test("うるう年の2月は29日になる", () => {
  const r = { anchorDate: "2028-01-31", freq: "MONTH" as const, intervalN: 1 };
  assert.equal(occurrenceOn(r, 1), "2028-02-29");
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2027, 2), 28);
});

test("RRULE のように2月を飛ばさない", () => {
  // RFC 5545 の BYMONTHDAY=31 は2月を省略する。課金では間違い。
  const months = [0, 1, 2, 3, 4, 5].map((k) => occurrenceOn(monthly31, k).slice(0, 7));
  assert.deepEqual(months, ["2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06"]);
});

test("anchorDay -1 は毎月末日", () => {
  const r = { anchorDate: "2027-01-31", freq: "MONTH" as const, intervalN: 1, anchorDay: -1 };
  assert.equal(occurrenceOn(r, 1), "2027-02-28");
  assert.equal(occurrenceOn(r, 3), "2027-04-30");
});

test("k の純関数である（前の回に依存しない＝ドリフトしない）", () => {
  // 飛び飛びに呼んでも順番に呼んでも同じ値になる
  const direct = occurrenceOn(monthly31, 13);
  const stepped = Array.from({ length: 14 }, (_, k) => occurrenceOn(monthly31, k))[13];
  assert.equal(direct, stepped);
  assert.equal(direct, "2028-02-29");
});

test("四半期は位相を保つ（1月/4月/7月/10月）", () => {
  const r = { anchorDate: "2027-01-15", freq: "MONTH" as const, intervalN: 3 };
  assert.equal(occurrenceOn(r, 1), "2027-04-15");
  assert.equal(occurrenceOn(r, 2), "2027-07-15");
  assert.equal(occurrenceOn(r, 3), "2027-10-15");
});

test("年額・週・隔週", () => {
  assert.equal(occurrenceOn({ anchorDate: "2027-02-14", freq: "YEAR", intervalN: 1 }, 1), "2028-02-14");
  assert.equal(occurrenceOn({ anchorDate: "2027-01-04", freq: "WEEK", intervalN: 1 }, 3), "2027-01-25");
  assert.equal(occurrenceOn({ anchorDate: "2027-01-04", freq: "WEEK", intervalN: 2 }, 2), "2027-02-01");
});

test("次の請求日", () => {
  assert.equal(nextOccurrenceOnOrAfter(monthly31, "2027-02-01"), "2027-02-28");
  // 当日ちょうどは「次」に含む
  assert.equal(nextOccurrenceOnOrAfter(monthly31, "2027-02-28"), "2027-02-28");
  assert.equal(nextOccurrenceOnOrAfter(monthly31, "2027-03-01"), "2027-03-31");
  // アンカーより前の日を渡しても最初の回を返す
  assert.equal(nextOccurrenceOnOrAfter(monthly31, "2026-12-01"), "2027-01-31");
  const yearly = { anchorDate: "2027-02-14", freq: "YEAR" as const, intervalN: 1 };
  assert.equal(nextOccurrenceOnOrAfter(yearly, "2029-06-01"), "2030-02-14");
});

test("年額換算（比較の正はこちら）", () => {
  assert.equal(annualizedMinor(1590, "MONTH", 1), 19080);
  assert.equal(annualizedMinor(5900, "YEAR", 1), 5900);
  assert.equal(annualizedMinor(3000, "MONTH", 3), 12000); // 四半期
  assert.equal(annualizedMinor(1000, "WEEK", 1), 52000);
  assert.equal(monthlyEquivalentMinor(annualizedMinor(5900, "YEAR", 1)), 492);
});

test("おかしな入力は例外にする", () => {
  assert.throws(() => occurrenceOn({ ...monthly31, intervalN: 0 }, 1));
  assert.throws(() => occurrenceOn(monthly31, 1.5));
  assert.throws(() => occurrenceOn({ ...monthly31, anchorDate: "2027/01/31" }, 0));
});
