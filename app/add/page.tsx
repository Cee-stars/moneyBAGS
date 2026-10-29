"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CATEGORIES, UNCATEGORIZED_LABEL } from "@/lib/categories";
import { deleteTxn, newId, putTxn, type Txn } from "@/lib/db";
import { formatAmount, money } from "@/lib/money";
import { todayISO } from "@/lib/recurrence";

const DRAFT_KEY = "mb.draft";
const MAX_DIGITS = 8;

type Draft = { amount: string; categoryId: string | null; date: string };

function readDraft(fallbackDate: string): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw !== null) {
      const d = JSON.parse(raw) as Partial<Draft>;
      if (typeof d.amount === "string" && typeof d.date === "string") {
        return {
          amount: d.amount,
          categoryId: typeof d.categoryId === "string" ? d.categoryId : null,
          date: d.date,
        };
      }
    }
  } catch {
    // 読めなくても困らない。空から始める。
  }
  return { amount: "", categoryId: null, date: fallbackDate };
}

export default function AddExpense() {
  const today = todayISO();
  const yesterday = (() => {
    const t = new Date();
    t.setDate(t.getDate() - 1);
    return todayISO(t);
  })();

  const [draft, setDraft] = useState<Draft>({ amount: "", categoryId: null, date: today });
  const [saved, setSaved] = useState<Txn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const restored = useRef(false);

  // 下書きを読み戻す。アプリを閉じても強制終了しても残る。
  useEffect(() => {
    setDraft(readDraft(today));
    restored.current = true;
  }, [today]);

  // 1打鍵ごとに保存する。保存時ではなく変更時（docs/PLAN.md §4.3）。
  useEffect(() => {
    if (!restored.current) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // 保存できなくても入力は続けられる。黙って続ける。
    }
  }, [draft]);

  const digits = draft.amount;
  const amountMinor = digits === "" ? 0 : Number(digits);
  const ready = amountMinor > 0;

  const press = (k: string) => {
    setSaved(null);
    setDraft((d) => {
      if (k === "del") return { ...d, amount: d.amount.slice(0, -1) };
      const next = (d.amount + k).replace(/^0+(?=\d)/, "");
      if (next.length > MAX_DIGITS) return d;
      return { ...d, amount: next };
    });
  };

  const save = async () => {
    if (!ready) return;
    const now = new Date().toISOString();
    const txn: Txn = {
      id: newId(),
      date: draft.date,
      amountMinor,
      currency: "JPY",
      categoryId: draft.categoryId,
      memo: "",
      createdAt: now,
      updatedAt: now,
    };
    try {
      await putTxn(txn);
      setError(null);
      setSaved(txn);
      // 金額だけ消して分類と日付は残す。記録はまとめて起きるので
      // 次の1件がすぐ入れられるようにする（docs/PLAN.md §4.3）。
      setDraft((d) => ({ ...d, amount: "" }));
    } catch {
      setError("保存できませんでした。もう一度試してください。");
    }
  };

  const undo = async () => {
    if (saved === null) return;
    try {
      await deleteTxn(saved.id);
      setDraft((d) => ({ ...d, amount: String(saved.amountMinor) }));
      setSaved(null);
    } catch {
      setError("取り消せませんでした。");
    }
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "del"];

  return (
    <main className="wrap">
      <header className="between">
        <h1 className="h1">支出を記録</h1>
        <Link href="/" className="link">
          ホームへ
        </Link>
      </header>

      <section className="card">
        <p className="sub">いくら使いましたか</p>
        <p className="money" style={{ textAlign: "right" }}>
          {formatAmount(money(amountMinor))}
        </p>
      </section>

      {saved !== null && (
        <section className="card" aria-live="polite">
          <div className="between" style={{ alignItems: "center" }}>
            <span style={{ fontSize: "var(--fs-body)" }}>
              {formatAmount(money(saved.amountMinor))} を記録しました
            </span>
            <button type="button" className="btn small" onClick={undo}>
              取り消す
            </button>
          </div>
        </section>
      )}

      {error !== null && (
        <section className="card attention" aria-live="polite">
          <p style={{ fontSize: "var(--fs-body)", lineHeight: "var(--lh-body)" }}>{error}</p>
        </section>
      )}

      <section>
        <p className="sub" style={{ marginBottom: 8 }}>
          なにに使いましたか（決めなくても記録できます）
        </p>
        <div className="grid-4">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className="chip"
              aria-pressed={draft.categoryId === c.id}
              onClick={() => setDraft((d) => ({ ...d, categoryId: c.id }))}
            >
              {c.name}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="chip"
          style={{ width: "100%", marginTop: 8 }}
          aria-pressed={draft.categoryId === null}
          onClick={() => setDraft((d) => ({ ...d, categoryId: null }))}
        >
          {UNCATEGORIZED_LABEL}
        </button>
      </section>

      <section>
        <p className="sub" style={{ marginBottom: 8 }}>
          いつ使いましたか
        </p>
        <div className="row">
          <button
            type="button"
            className="chip"
            style={{ flex: "1 1 0" }}
            aria-pressed={draft.date === today}
            onClick={() => setDraft((d) => ({ ...d, date: today }))}
          >
            今日
          </button>
          <button
            type="button"
            className="chip"
            style={{ flex: "1 1 0" }}
            aria-pressed={draft.date === yesterday}
            onClick={() => setDraft((d) => ({ ...d, date: yesterday }))}
          >
            昨日
          </button>
        </div>
        <label
          className="note"
          style={{ display: "block", marginTop: 8 }}
          htmlFor="date-pick"
        >
          別の日にする
        </label>
        <input
          id="date-pick"
          type="date"
          className="field"
          style={{ marginTop: 4 }}
          value={draft.date}
          max={today}
          onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
        />
      </section>

      <section className="grid-3">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            className="key"
            aria-label={k === "del" ? "1文字消す" : k}
            onClick={() => press(k)}
          >
            {k === "del" ? "⌫" : k}
          </button>
        ))}
      </section>

      <button type="button" className="btn primary" disabled={!ready} onClick={save}>
        {ready ? `${formatAmount(money(amountMinor))}を記録する` : "金額を入力してください"}
      </button>

      <p className="note" style={{ textAlign: "center" }}>
        記録したあともこの画面に残ります。続けて入れられます。
      </p>
    </main>
  );
}
