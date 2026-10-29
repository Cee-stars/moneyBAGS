"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import StorageCheck from "../storage-check";
import TextSize from "../text-size";
import { backupFileName, buildBackup, parseBackup, restoreBackup } from "@/lib/backup";
import { getAllTxns, getSetting, setSetting } from "@/lib/db";
import { formatAmount, money, parseAmount } from "@/lib/money";

export default function Settings() {
  const [budgetText, setBudgetText] = useState("");
  const [savedBudget, setSavedBudget] = useState<number | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const [b, txns, last] = await Promise.all([
          getSetting<number | null>("budgetMinor", null),
          getAllTxns(),
          getSetting<string | null>("lastBackupAt", null),
        ]);
        setSavedBudget(b);
        setBudgetText(b === null ? "" : String(b));
        setCount(txns.length);
        setLastBackupAt(last);
      } catch {
        setMessage({ kind: "warn", text: "設定を読み込めませんでした。" });
      }
    })();
  }, []);

  const saveBudget = async () => {
    // 全角数字・カンマ・「円」を受け入れる（日本語IMEは全角を常時生成する）
    const parsed = parseAmount(budgetText);
    if (parsed === null || parsed.amountMinor <= 0) {
      setMessage({ kind: "warn", text: "金額を入力してください（例：90000）" });
      return;
    }
    try {
      await setSetting("budgetMinor", parsed.amountMinor);
      setSavedBudget(parsed.amountMinor);
      setBudgetText(String(parsed.amountMinor));
      setMessage({ kind: "ok", text: `今月の予算を ${formatAmount(parsed)} にしました。` });
    } catch {
      setMessage({ kind: "warn", text: "保存できませんでした。" });
    }
  };

  /*
    書き出し。iOS では共有シートから「ファイルに保存」でiCloud Driveに置ける。
    共有に対応していない場合はダウンロードに落とす。
    途中でやめた場合は「書き出した」と記録しない。
  */
  const exportBackup = async () => {
    try {
      const data = await buildBackup();
      const text = JSON.stringify(data, null, 2);
      const name = backupFileName();
      const file = new File([text], name, { type: "application/json" });

      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "moneyBAGS のバックアップ" });
      } else {
        const url = URL.createObjectURL(file);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      }

      const now = new Date().toISOString();
      await setSetting("lastBackupAt", now);
      setLastBackupAt(now);
      setMessage({ kind: "ok", text: `${data.txns.length}件の記録を書き出しました。` });
    } catch (e) {
      // 共有シートを閉じただけなら失敗扱いにしない
      if (e instanceof DOMException && e.name === "AbortError") return;
      setMessage({ kind: "warn", text: "書き出せませんでした。" });
    }
  };

  /*
    読み込み。同じ id は上書き、ない id は追加。消しはしない。
    「読み込んだら今のデータが消えた」が一番やってはいけないこと。
  */
  const importBackup = async (file: File) => {
    try {
      const parsed = parseBackup(await file.text());
      if (!parsed.ok) {
        setMessage({ kind: "warn", text: parsed.reason });
        return;
      }
      const { added, replaced } = await restoreBackup(parsed.data);
      const txns = await getAllTxns();
      setCount(txns.length);
      setSavedBudget(await getSetting<number | null>("budgetMinor", null));
      setMessage({
        kind: "ok",
        text: `${added}件を追加し、${replaced}件を上書きしました。元からあった記録は消していません。`,
      });
    } catch {
      setMessage({ kind: "warn", text: "読み込めませんでした。" });
    }
  };

  return (
    <main className="wrap">
      <header className="between">
        <h1 className="h1">設定</h1>
        <Link href="/" className="link">
          ホームへ
        </Link>
      </header>

      {message !== null && (
        <section className={message.kind === "warn" ? "card attention" : "card"} aria-live="polite">
          <p style={{ fontSize: "var(--fs-body)", lineHeight: "var(--lh-body)" }}>{message.text}</p>
        </section>
      )}

      <section className="card">
        <h2 className="h2">今月の予算</h2>
        <p className="sub" style={{ marginBottom: 10 }}>
          1ヶ月にいくらまで使うか。あとから変えられます。
        </p>
        <input
          type="text"
          inputMode="numeric"
          className="field"
          placeholder="90000"
          value={budgetText}
          onChange={(e) => setBudgetText(e.target.value)}
          aria-label="今月の予算"
        />
        <div style={{ marginTop: 8 }}>
          <button type="button" className="btn" onClick={saveBudget}>
            予算を保存する
          </button>
        </div>
        {savedBudget !== null && (
          <p className="note divider">
            いまの予算：{formatAmount(money(savedBudget))}
          </p>
        )}
      </section>

      <section className="card">
        <h2 className="h2">バックアップ</h2>
        <p style={{ fontSize: "var(--fs-body)", lineHeight: "var(--lh-body)" }}>
          記録はこの端末の中だけにあります。iPhone
          はしばらく使わないと保存データを消すことがあるので、ときどき書き出してください。
        </p>

        <div className="stack" style={{ marginTop: 12 }}>
          <button type="button" className="btn primary" onClick={exportBackup}>
            バックアップを書き出す
          </button>
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
            バックアップを読み込む
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importBackup(f);
              e.target.value = "";
            }}
          />
        </div>

        <p className="note divider">
          書き出すと共有メニューが開きます。「ファイルに保存」を選ぶと iCloud Drive
          に置けます。
          <br />
          読み込んでも、いまある記録は消えません。同じ記録だけ上書きされます。
          {count !== null && (
            <>
              <br />
              いまの記録：{count}件
            </>
          )}
          {lastBackupAt !== null && (
            <>
              <br />
              最後に書き出したのは {new Date(lastBackupAt).toLocaleString("ja-JP")} です。
            </>
          )}
        </p>
      </section>

      <TextSize />
      <StorageCheck />
    </main>
  );
}
