"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getTxnsBetween, isAvailable, type Txn } from "@/lib/db";
import { categoryName } from "@/lib/categories";
import { formatAmount, money } from "@/lib/money";
import { monthRange, todayISO } from "@/lib/recurrence";
import {
  categoryTotals,
  dayLabel,
  daysInMonthOf,
  groupByDay,
  isFutureMonth,
  monthLabel,
  recordedDayCount,
  shiftMonth,
  totalMinor,
} from "@/lib/summary";

/*
  記録を読み返す画面。家計簿の本体。

  「1日に何へ何円使ったか」が分からなければ家計簿ではない。
  入れるだけの画面と、残りを見る画面だけでは足りない。
*/
export default function History() {
  const today = todayISO();
  const [month, setMonth] = useState(() => today.slice(0, 7) + "-01");
  const [txns, setTxns] = useState<Txn[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isAvailable()) {
      setFailed(true);
      return;
    }
    let cancelled = false;
    setTxns(null);
    const { start, end } = monthRange(month);
    getTxnsBetween(start, end)
      .then((rows) => {
        if (!cancelled) setTxns(rows);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  const canGoForward = !isFutureMonth(shiftMonth(month, 1), today);

  return (
    <main className="wrap">
      <header className="between">
        <h1 className="h1">記録</h1>
        <Link href="/" className="link">
          ホームへ
        </Link>
      </header>

      <div className="row" style={{ alignItems: "center" }}>
        <button
          type="button"
          className="btn small"
          onClick={() => setMonth((m) => shiftMonth(m, -1))}
          aria-label="前の月"
        >
          ‹ 前の月
        </button>
        <div
          style={{
            flex: "1 1 auto",
            textAlign: "center",
            fontSize: "var(--fs-item)",
            fontWeight: 700,
          }}
          aria-live="polite"
        >
          {monthLabel(month)}
        </div>
        <button
          type="button"
          className="btn small"
          disabled={!canGoForward}
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
          aria-label="次の月"
        >
          次の月 ›
        </button>
      </div>

      {failed && (
        <section className="card attention">
          <p style={{ fontSize: "var(--fs-body)", lineHeight: "var(--lh-body)" }}>
            記録を読み込めませんでした。
          </p>
        </section>
      )}

      {!failed && txns === null && (
        <section className="card">
          <p className="sub">読み込んでいます…</p>
        </section>
      )}

      {txns !== null && <MonthBody month={month} txns={txns} />}

      <Link href="/add/" className="btn primary">
        支出を記録する
      </Link>
    </main>
  );
}

function MonthBody({ month, txns }: { month: string; txns: Txn[] }) {
  if (txns.length === 0) {
    return (
      <section className="card">
        <h2 className="h2">この月の記録はまだありません</h2>
        <p className="sub" style={{ lineHeight: "var(--lh-body)" }}>
          記録がない月です。使わなかったのか、入れていないだけなのかは分かりません。
        </p>
      </section>
    );
  }

  const days = groupByDay(txns);
  const cats = categoryTotals(txns);
  const total = totalMinor(txns);
  const recorded = recordedDayCount(txns);

  return (
    <>
      <section className="card">
        <p className="sub">この月に使ったお金</p>
        <p className="money">{formatAmount(money(total))}</p>
        <p className="sub divider" style={{ lineHeight: "var(--lh-body)" }}>
          {txns.length}件の記録／{daysInMonthOf(month)}日のうち {recorded}日分
        </p>
      </section>

      <section className="card">
        <h2 className="h2">何に使ったか</h2>
        <div className="stack">
          {cats.map((c) => {
            const pct = total > 0 ? Math.round((c.totalMinor / total) * 100) : 0;
            return (
              <div key={c.categoryId ?? "none"}>
                <div className="between" style={{ marginBottom: 4 }}>
                  <span style={{ fontSize: "var(--fs-body)" }}>
                    {c.name}
                    <span className="sub"> （{c.count}件）</span>
                  </span>
                  <span style={{ fontSize: "var(--fs-body)", fontWeight: 700 }}>
                    {formatAmount(money(c.totalMinor))}
                  </span>
                </div>
                <div className="between" style={{ alignItems: "center", gap: 10 }}>
                  <div className="bar" style={{ flex: "1 1 auto" }}>
                    <span style={{ width: `${pct}%` }} />
                  </div>
                  {/* 割合は棒の長さだけで伝えない。数字も必ず出す（WCAG 1.4.1） */}
                  <span className="note" style={{ minWidth: "3em", textAlign: "right" }}>
                    {pct}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {days.map((d) => (
        <section className="card" key={d.date}>
          <div className="between" style={{ marginBottom: 10 }}>
            <h2 className="h2" style={{ margin: 0 }}>
              {dayLabel(d.date)}
            </h2>
            <span style={{ fontSize: "var(--fs-body)", fontWeight: 700 }}>
              {formatAmount(money(d.totalMinor))}
            </span>
          </div>
          <div className="stack">
            {d.items.map((t) => (
              <div
                key={t.id}
                className="between"
                style={{
                  alignItems: "center",
                  paddingTop: 8,
                  borderTop: "1px solid var(--border-soft)",
                }}
              >
                <span style={{ fontSize: "var(--fs-body)" }}>{categoryName(t.categoryId)}</span>
                <span className="row" style={{ alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: "var(--fs-body)", fontWeight: 700 }}>
                    {formatAmount(money(t.amountMinor))}
                  </span>
                  <Link href={`/add/?id=${encodeURIComponent(t.id)}`} className="btn small">
                    直す
                  </Link>
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
