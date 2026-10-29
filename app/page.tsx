"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSetting, getTxnsBetween, isAvailable, requestPersistence, type Txn } from "@/lib/db";
import { formatAmount, money, sumMoney } from "@/lib/money";
import { daysInMonth, monthRange, parseISODate, todayISO } from "@/lib/recurrence";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const BACKUP_REMINDER_DAYS = 7;

type Loaded = {
  txns: Txn[];
  budgetMinor: number | null;
  lastBackupAt: string | null;
};

export default function Home() {
  const [state, setState] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!isAvailable()) {
      setFailed("このブラウザではデータを保存できません。");
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        // 毎回要求する。Safari は利用履歴から自動で許可/不許可を決める。
        await requestPersistence();
        const { start, end } = monthRange(todayISO());
        const [txns, budgetMinor, lastBackupAt] = await Promise.all([
          getTxnsBetween(start, end),
          getSetting<number | null>("budgetMinor", null),
          getSetting<string | null>("lastBackupAt", null),
        ]);
        if (!cancelled) setState({ txns, budgetMinor, lastBackupAt });
      } catch {
        if (!cancelled) setFailed("保存されたデータを読み込めませんでした。");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const today = todayISO();
  const { y, m, d } = parseISODate(today);
  const total = daysInMonth(y, m);
  const daysLeft = total - d + 1;
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];

  return (
    <main className="wrap">
      <header className="between">
        <h1 className="h1">
          {m}月{d}日（{weekday}）
        </h1>
        <span className="sub">今月あと{daysLeft}日</span>
      </header>

      {failed !== null && (
        <section className="card attention">
          <h2 className="h2">読み込めませんでした</h2>
          <p style={{ fontSize: "var(--fs-body)", lineHeight: "var(--lh-body)" }}>{failed}</p>
        </section>
      )}

      {failed === null && state === null && (
        <section className="card">
          <p className="sub">読み込んでいます…</p>
        </section>
      )}

      {state !== null && (
        <>
          <Budget state={state} day={d} total={total} daysLeft={daysLeft} month={m} />
          <Link href="/add/" className="btn primary">
            支出を記録する
          </Link>
          <BackupStatus lastBackupAt={state.lastBackupAt} />
          <Link href="/settings/" className="link" style={{ textAlign: "center" }}>
            設定とバックアップ
          </Link>
        </>
      )}
    </main>
  );
}

function Budget({
  state,
  day,
  total,
  daysLeft,
  month,
}: {
  state: Loaded;
  day: number;
  total: number;
  daysLeft: number;
  month: number;
}) {
  const spent = sumMoney(state.txns.map((t) => money(t.amountMinor, "JPY")));
  const recordedDays = new Set(state.txns.map((t) => t.date)).size;
  const uncategorized = state.txns.filter((t) => t.categoryId === null).length;

  if (state.budgetMinor === null) {
    return (
      <>
        <section className="card attention">
          <h2 className="h2">まず今月の予算を決めてください</h2>
          <p style={{ fontSize: "var(--fs-body)", lineHeight: "var(--lh-body)" }}>
            予算を決めると「今月あといくら使えるか」が出ます。あとから変えられます。
          </p>
          <div className="divider">
            <Link href="/settings/" className="btn">
              予算を決める
            </Link>
          </div>
        </section>
        <Recorded month={month} day={day} recordedDays={recordedDays} spent={spent.amountMinor} uncategorized={uncategorized} />
      </>
    );
  }

  const remaining = state.budgetMinor - spent.amountMinor;
  const over = remaining < 0;
  const ratio = Math.min(1, Math.max(0, spent.amountMinor / state.budgetMinor));
  const perDay = daysLeft > 0 ? Math.floor(remaining / daysLeft) : remaining;

  return (
    <>
      <section className="card">
        <p className="sub">{over ? "今月の予算を超えた分" : "今月あと使えるお金"}</p>
        <p className="money">{formatAmount(money(Math.abs(remaining)))}</p>

        <div className="between" style={{ margin: "14px 0 8px", alignItems: "center" }}>
          <div className="bar" style={{ flex: "1 1 auto" }}>
            <span style={{ width: `${ratio * 100}%` }} />
          </div>
          <span style={{ fontSize: "var(--fs-sub)", fontWeight: 700, color: "var(--ink-2)" }}>
            {Math.round(ratio * 100)}%
          </span>
        </div>

        <p className="sub" style={{ lineHeight: 1.8 }}>
          予算 {formatAmount(money(state.budgetMinor))} のうち{" "}
          {formatAmount(spent)} を使いました
          <br />
          {over
            ? "今月はあと使える分がありません。"
            : `1日あたり あと ${formatAmount(money(Math.max(0, perDay)))} まで`}
        </p>
      </section>
      <Recorded month={month} day={day} recordedDays={recordedDays} spent={spent.amountMinor} uncategorized={uncategorized} />
    </>
  );
}

/*
  記録の状況を正直に出す。完全であるフリをしない（docs/PLAN.md §4.3）。
  そして記録していない日があっても催促しない。
*/
function Recorded({
  month,
  day,
  recordedDays,
  spent,
  uncategorized,
}: {
  month: number;
  day: number;
  recordedDays: number;
  spent: number;
  uncategorized: number;
}) {
  return (
    <section className="card">
      <h2 className="h2">記録の状況</h2>
      <p style={{ fontSize: "var(--fs-body)", lineHeight: "var(--lh-body)" }}>
        {month}月の{day}日のうち、記録があるのは <b>{recordedDays}日</b> です。
      </p>
      {recordedDays < day && spent > 0 && (
        <p className="note" style={{ marginTop: 8 }}>
          記録がない日の支出は0として数えています。実際の残りはもう少し少ないかもしれません。
        </p>
      )}
      {uncategorized > 0 && (
        <p className="note" style={{ marginTop: 8 }}>
          分類をあとで決める記録が {uncategorized}件 あります。そのままでも合計は正しく出ます。
        </p>
      )}
    </section>
  );
}

function BackupStatus({ lastBackupAt }: { lastBackupAt: string | null }) {
  if (lastBackupAt === null) {
    return (
      <section className="card attention">
        <h2 className="h2">まだバックアップを書き出していません</h2>
        <p style={{ fontSize: "var(--fs-body)", lineHeight: "var(--lh-body)" }}>
          記録はこの端末の中だけにあります。iPhone
          はしばらく使わないと保存データを消すことがあります。
        </p>
        <div className="divider">
          <Link href="/settings/" className="btn">
            バックアップを書き出す
          </Link>
        </div>
      </section>
    );
  }

  const last = new Date(lastBackupAt);
  const days = Math.floor((Date.now() - last.getTime()) / 86400000);
  const stale = days >= BACKUP_REMINDER_DAYS;

  return (
    <section className={stale ? "card attention" : "card"}>
      <h2 className="h2">バックアップ</h2>
      <p style={{ fontSize: "var(--fs-body)", lineHeight: "var(--lh-body)" }}>
        最後に書き出したのは {last.getFullYear()}年{last.getMonth() + 1}月{last.getDate()}日
        （{days === 0 ? "今日" : `${days}日前`}）です。
      </p>
      {stale && (
        <div className="divider">
          <Link href="/settings/" className="btn">
            書き出す
          </Link>
        </div>
      )}
    </section>
  );
}
