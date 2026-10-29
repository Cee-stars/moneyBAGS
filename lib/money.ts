/*
  お金の持ち方。docs/PLAN.md §2.1

  決定: 整数の最小単位で持つ。通貨ごとの指数は1箇所（ここ）だけに置く。
  JPY は指数0なので 1200 は 1,200円。USD は指数2なので 1200 は $12.00。

  金額を裸の数値で持ち回らない。必ず通貨とセットにする。
  一番怖いバグは JPY を指数2のつもりで 120000 と書くこと。表示するまで
  気づかず100倍ずれる。入出力の境界をこのファイルに集約して防ぐ。
*/

export type CurrencyCode = "JPY" | "USD";

export const CURRENCY: Record<CurrencyCode, { exponent: number; label: string }> = {
  JPY: { exponent: 0, label: "円" },
  USD: { exponent: 2, label: "ドル" },
};

export type Money = { readonly amountMinor: number; readonly currency: CurrencyCode };

export function money(amountMinor: number, currency: CurrencyCode = "JPY"): Money {
  if (!Number.isInteger(amountMinor)) {
    throw new Error(`金額は整数の最小単位で渡してください: ${amountMinor}`);
  }
  return { amountMinor, currency };
}

/*
  入力の正規化。日本語IMEは全角数字を常時生成するので、弾くのは
  自分で作ったエラー源になる（docs/PLAN.md §1.6）。
  NFKC で ０-９ → 0-9、￥ → ¥、， → , などがまとめて半角になる。
*/
export function normalizeAmountInput(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[,\s¥￥円]/g, "")
    .trim();
}

/*
  文字列を最小単位の整数にする。読めなければ null（例外にしない）。
  小数は文字列のまま処理する。19.99 * 100 のような浮動小数点の掛け算を
  通さないため。
*/
export function parseAmount(raw: string, currency: CurrencyCode = "JPY"): Money | null {
  const s = normalizeAmountInput(raw);
  if (s === "" || !/^-?\d*(\.\d*)?$/.test(s) || !/\d/.test(s)) return null;

  const negative = s.startsWith("-");
  const body = negative ? s.slice(1) : s;
  const [intPart = "0", fracPart = ""] = body.split(".");
  const exponent = CURRENCY[currency].exponent;

  // 小数部を指数の桁に揃える。足りなければ0で埋め、多ければ次の桁で四捨五入。
  const kept = fracPart.slice(0, exponent).padEnd(exponent, "0");
  const nextDigit = fracPart.charAt(exponent);
  let minor = Number(intPart + kept);
  if (!Number.isFinite(minor)) return null;
  if (nextDigit !== "" && Number(nextDigit) >= 5) minor += 1;

  return money(negative ? -minor : minor, currency);
}

/** 表示用。JPY は「1,200円」、USD は「12.00ドル」。 */
export function formatAmount(m: Money, opts: { unit?: boolean } = {}): string {
  const { exponent, label } = CURRENCY[m.currency];
  const sign = m.amountMinor < 0 ? "-" : "";
  const abs = Math.abs(m.amountMinor);
  const whole = Math.floor(abs / 10 ** exponent);
  const frac = abs % 10 ** exponent;

  let text = sign + whole.toLocaleString("ja-JP");
  if (exponent > 0) text += "." + String(frac).padStart(exponent, "0");
  return opts.unit === false ? text : text + label;
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`通貨が違う金額は足せません: ${a.currency} と ${b.currency}`);
  }
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function sumMoney(list: readonly Money[], currency: CurrencyCode = "JPY"): Money {
  return list.reduce<Money>((acc, m) => addMoney(acc, m), money(0, currency));
}

/*
  割る。最大剰余法で端数を配るので、分けたものの合計は必ず元に戻る。
  年額を12で割ると最大11円ずれるので、放置せずここで扱う（docs/PLAN.md §2.1）。
*/
export function splitMoney(m: Money, parts: number): Money[] {
  if (!Number.isInteger(parts) || parts < 1) {
    throw new Error(`分割数は1以上の整数にしてください: ${parts}`);
  }
  const base = Math.trunc(m.amountMinor / parts);
  const remainder = m.amountMinor - base * parts;
  const step = remainder >= 0 ? 1 : -1;
  let left = Math.abs(remainder);

  return Array.from({ length: parts }, () => {
    const extra = left > 0 ? step : 0;
    if (left > 0) left -= 1;
    return money(base + extra, m.currency);
  });
}
