import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseAmount,
  formatAmount,
  money,
  sumMoney,
  splitMoney,
  normalizeAmountInput,
} from "./money.ts";

test("全角数字を受け入れる（日本語IMEが常時生成するため）", () => {
  assert.equal(parseAmount("１２００")?.amountMinor, 1200);
  assert.equal(parseAmount("１，２００円")?.amountMinor, 1200);
});

test("カンマ・円記号・空白を落とす", () => {
  assert.equal(normalizeAmountInput(" 1,200 円 "), "1200");
  assert.equal(parseAmount("¥1,200")?.amountMinor, 1200);
  assert.equal(parseAmount("1200円")?.amountMinor, 1200);
});

test("JPY は指数0。小数を書かれたら四捨五入する", () => {
  assert.equal(parseAmount("1200")?.amountMinor, 1200);
  assert.equal(parseAmount("1200.00")?.amountMinor, 1200);
  assert.equal(parseAmount("1200.4")?.amountMinor, 1200);
  assert.equal(parseAmount("1200.5")?.amountMinor, 1201);
});

test("USD は指数2。浮動小数点を通さない", () => {
  assert.equal(parseAmount("19.99", "USD")?.amountMinor, 1999);
  assert.equal(parseAmount("0.1", "USD")?.amountMinor, 10);
  assert.equal(parseAmount("12", "USD")?.amountMinor, 1200);
  assert.equal(parseAmount("1.005", "USD")?.amountMinor, 101);
});

test("読めない入力は例外ではなく null", () => {
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("   "), null);
  assert.equal(parseAmount("あああ"), null);
  assert.equal(parseAmount("円"), null);
  assert.equal(parseAmount("1.2.3"), null);
});

test("表示", () => {
  assert.equal(formatAmount(money(1200)), "1,200円");
  assert.equal(formatAmount(money(0)), "0円");
  assert.equal(formatAmount(money(-500)), "-500円");
  assert.equal(formatAmount(money(1999, "USD")), "19.99ドル");
  assert.equal(formatAmount(money(1200), { unit: false }), "1,200");
});

test("通貨が違う金額は足せない", () => {
  assert.throws(() => sumMoney([money(1, "JPY"), money(1, "USD")]));
});

test("整数以外の最小単位は受け付けない", () => {
  assert.throws(() => money(12.5));
});

test("割った合計は必ず元に戻る（年額を12ヶ月に配る）", () => {
  const parts = splitMoney(money(11980), 12);
  assert.equal(parts.length, 12);
  assert.equal(sumMoney(parts).amountMinor, 11980);
  // 端数は先頭から配られる
  assert.equal(parts[0].amountMinor, 999);
  assert.equal(parts[11].amountMinor, 998);
});

test("割り切れる場合も合計が戻る", () => {
  assert.equal(sumMoney(splitMoney(money(12000), 12)).amountMinor, 12000);
});
