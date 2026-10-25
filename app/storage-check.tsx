"use client";

import { useEffect, useState } from "react";

type State = {
  persisted: boolean | null;
  quotaMB: number | null;
  supported: boolean;
};

/*
  iOS は7日間使わないとブラウザのストレージを削除する（iOS 13.4以降）。
  ホーム画面に追加したアプリは別カウントとされているが、それでも消えたという
  報告がある。なので navigator.storage.persist() を毎回起動時に要求し、
  その結果を画面に出して本人が確認できるようにする。

  これは「許可されたから安全」という保証ではない。バックアップ書き出しが
  中核機能である理由そのもの（docs/PLAN.md §3.1）。
*/
export default function StorageCheck() {
  const [state, setState] = useState<State>({
    persisted: null,
    quotaMB: null,
    supported: true,
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!navigator.storage?.persist) {
        if (!cancelled) setState((s) => ({ ...s, supported: false }));
        return;
      }
      try {
        // 起動ごとに要求する。Safari は利用履歴から自動で許可/不許可を決める。
        const persisted = await navigator.storage.persist();
        const estimate = await navigator.storage.estimate?.();
        const quotaMB = estimate?.quota
          ? Math.round(estimate.quota / 1024 / 1024)
          : null;
        if (!cancelled) setState({ persisted, quotaMB, supported: true });
      } catch {
        if (!cancelled) setState((s) => ({ ...s, supported: false }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const rowStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    fontSize: 14,
    lineHeight: 1.9,
  };

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
        この端末のデータ保存の状態
      </div>

      {!state.supported ? (
        <div style={{ fontSize: 14, lineHeight: 1.85, color: "var(--ink-3)" }}>
          このブラウザは保存状態を確認できません。
        </div>
      ) : (
        <>
          <div style={rowStyle}>
            <span style={{ color: "var(--ink-3)" }}>消えにくい設定</span>
            <span style={{ fontWeight: 700 }}>
              {state.persisted === null
                ? "確認中"
                : state.persisted
                  ? "許可された"
                  : "許可されなかった"}
            </span>
          </div>
          <div style={rowStyle}>
            <span style={{ color: "var(--ink-3)" }}>使える容量のめやす</span>
            <span style={{ fontWeight: 700 }}>
              {state.quotaMB === null ? "不明" : `${state.quotaMB} MB`}
            </span>
          </div>
        </>
      )}

      <div
        style={{
          marginTop: 12,
          paddingTop: 10,
          borderTop: "1px solid var(--border-soft)",
          fontSize: 12,
          lineHeight: 1.75,
          color: "var(--ink-3)",
        }}
      >
        許可されても安全とは限りません。iOSは7日間使わないと保存データを消すことがあります。だからバックアップの書き出しを中心の機能として作ります。
      </div>
    </div>
  );
}
