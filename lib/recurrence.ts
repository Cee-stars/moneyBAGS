/*
  請求日の計算。docs/PLAN.md §2.3

  決定（Firefly III のソースと Stripe の挙動で確認済み）:
  ・要求された日を保存し、計算時に min(要求日, その月の日数) でクランプする。
  ・クランプ後の値を保存してはいけない。保存すると28日に下がったまま
    二度と31日に戻らない。
  ・k番目は (anchorDate, freq, intervalN, k) の純関数にする。前の回から
    計算しない。これでドリフトが起きず、何度再生成しても同じ結果になる。
  ・RRULE文字列は保存しない。RFC 5545 の BYMONTHDAY=31 はクランプせず
    「省略」する = 2月4月6月9月11月を飛ばす。課金の意味として間違い。

  日付は暦日であって瞬間ではないので、文字列 YYYY-MM-DD で扱う。
*/

export type Freq = "DAY" | "WEEK" | "MONTH" | "YEAR";

export type Recurrence = {
  /** 最初の実請求日。位相を決める。倍数が2以上のとき特に重要。 */
  anchorDate: string;
  freq: Freq;
  /** 倍数。四半期 = MONTH の 3、隔週 = WEEK の 2。 */
  intervalN: number;
  /** 1..31、または -1 で「月末日」。省略時は anchorDate の日。 */
  anchorDay?: number;
};

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseISODate(iso: string): { y: number; m: number; d: number } {
  const match = ISO.exec(iso);
  if (!match) throw new Error(`日付は YYYY-MM-DD で渡してください: ${iso}`);
  const [, y, m, d] = match;
  return { y: Number(y), m: Number(m), d: Number(d) };
}

export function toISODate(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addDays(iso: string, days: number): string {
  const { y, m, d } = parseISODate(iso);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return toISODate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function addMonths(iso: string, months: number, anchorDay?: number): string {
  const { y, m, d } = parseISODate(iso);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = daysInMonth(ny, nm);

  const requested = anchorDay ?? d;
  // ここがクランプ。要求日は保存したまま、出すときだけ丸める。
  const day = requested === -1 ? last : Math.min(requested, last);
  return toISODate(ny, nm, day);
}

/** k番目（0始まり）の請求日。k の純関数。 */
export function occurrenceOn(r: Recurrence, k: number): string {
  if (!Number.isInteger(k)) throw new Error(`k は整数にしてください: ${k}`);
  if (!Number.isInteger(r.intervalN) || r.intervalN < 1) {
    throw new Error(`intervalN は1以上の整数にしてください: ${r.intervalN}`);
  }
  switch (r.freq) {
    case "DAY":
      return addDays(r.anchorDate, k * r.intervalN);
    case "WEEK":
      return addDays(r.anchorDate, k * r.intervalN * 7);
    case "MONTH":
      return addMonths(r.anchorDate, k * r.intervalN, r.anchorDay);
    case "YEAR":
      return addMonths(r.anchorDate, k * r.intervalN * 12, r.anchorDay);
  }
}

/** today 以降で最初の請求日。見つからない形にはならないので必ず返る。 */
export function nextOccurrenceOnOrAfter(r: Recurrence, today: string): string {
  const a = parseISODate(r.anchorDate);
  const t = parseISODate(today);

  // おおよその k を出してから前後に詰める。線形探索を短く保つため。
  const perStepMonths =
    r.freq === "MONTH" ? r.intervalN : r.freq === "YEAR" ? r.intervalN * 12 : 0;
  let k =
    perStepMonths > 0
      ? Math.floor(((t.y * 12 + t.m) - (a.y * 12 + a.m)) / perStepMonths)
      : Math.floor(
          (Date.UTC(t.y, t.m - 1, t.d) - Date.UTC(a.y, a.m - 1, a.d)) /
            (86400000 * r.intervalN * (r.freq === "WEEK" ? 7 : 1)),
        );
  if (!Number.isFinite(k) || k < 0) k = 0;

  while (k > 0 && occurrenceOn(r, k - 1) >= today) k -= 1;
  while (occurrenceOn(r, k) < today) k += 1;
  return occurrenceOn(r, k);
}

const PERIODS_PER_YEAR: Record<Freq, number> = { DAY: 365, WEEK: 52, MONTH: 12, YEAR: 1 };

/*
  年額を正とする。docs/PLAN.md §2.4
  月額は「年額 ÷ 12」を表示の最後だけで出す。月額を個別に丸めてから
  合計すると、合計がずれる。
*/
export function annualizedMinor(amountMinor: number, freq: Freq, intervalN: number): number {
  if (!Number.isInteger(intervalN) || intervalN < 1) {
    throw new Error(`intervalN は1以上の整数にしてください: ${intervalN}`);
  }
  return Math.round((amountMinor * PERIODS_PER_YEAR[freq]) / intervalN);
}

export function monthlyEquivalentMinor(annualized: number): number {
  return Math.round(annualized / 12);
}

/** 今日の日付（端末のローカル時刻）。暦日なのでUTCではなくローカルで出す。 */
export function todayISO(now: Date = new Date()): string {
  return toISODate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** その月の初日と末日。 */
export function monthRange(iso: string): { start: string; end: string } {
  const { y, m } = parseISODate(iso);
  return { start: toISODate(y, m, 1), end: toISODate(y, m, daysInMonth(y, m)) };
}
