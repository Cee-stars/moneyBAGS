"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CATEGORIES, UNCATEGORIZED_LABEL } from "@/lib/categories";
import { deleteTxn, getTxn, newId, putTxn, type Txn } from "@/lib/db";
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

  // 直す対象の id。?id=... で渡ってくる。
  // useSearchParams は静的書き出しだと Suspense が要るので、素直に読む。
  const [editId, setEditId] = useState<string | null>(null);
  const [loadedEdit, setLoadedEdit] = useState(false);
  const [original, setOriginal] = useState<Txn | null>(null);

  const [draft, setDraft] = useState<Draft>({ amount: "", categoryId: null, date: today });
  const [saved, setSaved] = useState<Txn | null>(null);
  const [deleted, setDeleted] = useState<Txn | null>(null);
  const [edited, setEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restored = useRef(false);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    setEditId(id);

    if (id === null) {
      // 新しく入れるとき: 下書きを読み戻す
      setDraft(readDraft(today));
      restored.current = true;
      setLoadedEdit(true);
      return;
    }

    // 直すとき: 下書きには触らない（入力途中の別の記録を壊さないため）
    getTxn(id)
      .then((t) => {
        if (t) {
          setOriginal(t);
          setDraft({
            amount: String(t.amountMinor),
            categoryId: t.categoryId,
            date: t.date,
          });
        } else {
          setError("その記録が見つかりませんでした。消されたのかもしれません。");
        }
      })
      .catch(() => setError("記録を読み込めませんでした。"))
      .finally(() => setLoadedEdit(true));
  }, [today]);

  // 1打鍵ごとに保存する。保存時ではなく変更時（docs/PLAN.md §4.3）。
  // 直しているときは下書きを上書きしない。
  useEffect(() => {
    if (!restored.current || editId !== null) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // 保存できなくても入力は続けられる。黙って続ける。
    }
  }, [draft, editId]);

  const isEdit = editId !== null;
  const amountMinor = draft.amount === "" ? 0 : Number(draft.amount);
  const ready = amountMinor > 0 && (!isEdit || original !== null);

  const press = (k: string) => {
    setSaved(null);
    setEdited(false);
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
    const txn: Txn = isEdit
      ? { ...original!, date: draft.date, amountMinor, categoryId: draft.categoryId, updatedAt: now }
      : {
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
      if (isEdit) {
        setOriginal(txn);
        setEdited(true);
      } else {
        setSaved(txn);
        // 金額だけ消して分類と日付は残す。記録はまとめて起きるので
        // 次の1件がすぐ入れられるようにする（docs/PLAN.md §4.3）。
        setDraft((d) => ({ ...d, amount: "" }));
      }
    } catch {
      setError("保存できませんでした。もう一度試してください。");
    }
  };

  const undoSave = async () => {
    if (saved === null) return;
    try {
      await deleteTxn(saved.id);
      setDraft((d) => ({ ...d, amount: String(saved.amountMinor) }));
      setSaved(null);
    } catch {
      setError("取り消せませんでした。");
    }
  };

  /* 消すのは確認の窓を出さずに、取り消せるようにする（docs/PLAN.md §1.6）。 */
  const remove = async () => {
    if (original === null) return;
    try {
      await deleteTxn(original.id);
      setDeleted(original);
      setOriginal(null);
      setError(null);
    } catch {
      setError("消せませんでした。");
    }
  };

  const undoDelete = async () => {
    if (deleted === null) return;
    try {
      await putTxn(deleted);
      setOriginal(deleted);
      setDeleted(null);
    } catch {
      setError("戻せませんでした。");
    }
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "del"];

  return (
    <main className="wrap">
      <header className="between">
        <h1 className="h1">{isEdit ? "記録を直す" : "支出を記録"}</h1>
        <Link href={isEdit ? "/history/" : "/"} className="link">
          {isEdit ? "記録へ" : "ホームへ"}
        </Link>
      </header>

      {isEdit && deleted !== null && (
        <section className="card attention" aria-live="polite">
          <div className="between" style={{ alignItems: "center" }}>
            <span style={{ fontSize: "var(--fs-body)" }}>
              {formatAmount(money(deleted.amountMinor))} の記録を消しました
            </span>
            <button type="button" className="btn small" onClick={undoDelete}>
              取り消す
            </button>
          </div>
          <p className="note divider">
            この画面を離れると戻せなくなります。
            <Link href="/history/" className="link">
              {" "}
              記録へ戻る
            </Link>
          </p>
        </section>
      )}

      {deleted === null && (
        <>
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
                <button type="button" className="btn small" onClick={undoSave}>
                  取り消す
                </button>
              </div>
            </section>
          )}

          {edited && (
            <section className="card" aria-live="polite">
              <div className="between" style={{ alignItems: "center" }}>
                <span style={{ fontSize: "var(--fs-body)" }}>直しました</span>
                <Link href="/history/" className="btn small">
                  記録へ
                </Link>
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
            <label className="note" style={{ display: "block", marginTop: 8 }} htmlFor="date-pick">
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
            {!ready
              ? isEdit && !loadedEdit
                ? "読み込んでいます…"
                : "金額を入力してください"
              : isEdit
                ? `${formatAmount(money(amountMinor))}に直す`
                : `${formatAmount(money(amountMinor))}を記録する`}
          </button>

          {isEdit ? (
            <button type="button" className="btn" onClick={remove} disabled={original === null}>
              この記録を消す
            </button>
          ) : (
            <p className="note" style={{ textAlign: "center" }}>
              記録したあともこの画面に残ります。続けて入れられます。
            </p>
          )}
        </>
      )}
    </main>
  );
}
