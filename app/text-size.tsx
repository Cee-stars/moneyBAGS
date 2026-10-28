"use client";

import { useEffect, useState } from "react";

type Size = "default" | "large" | "xlarge";

const OPTIONS: { value: Size; label: string }[] = [
  { value: "default", label: "標準" },
  { value: "large", label: "大きい" },
  { value: "xlarge", label: "もっと大きい" },
];

const KEY = "mb.textSize";

/*
  文字の大きさ。3段階だけ。スライダーにしないのは、無段階だと調整そのものが
  終わらない作業になるため（docs/PLAN.md §4.8）。
  行間もこの1つのつまみで一緒に変わる。
*/
export default function TextSize() {
  const [size, setSize] = useState<Size>("default");

  // 初回だけ、すでに当たっている値を読み直して選択状態を合わせる
  useEffect(() => {
    try {
      const stored = localStorage.getItem(KEY);
      if (stored === "large" || stored === "xlarge") setSize(stored);
    } catch {
      // private モードなどで読めないことがある。既定のままで動かす。
    }
  }, []);

  const apply = (next: Size) => {
    setSize(next);
    if (next === "default") {
      delete document.documentElement.dataset.text;
    } else {
      document.documentElement.dataset.text = next;
    }
    try {
      if (next === "default") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // 保存できなくても表示は変わる。黙って続ける。
    }
  };

  return (
    <section
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: 16,
      }}
    >
      <h2
        style={{
          margin: "0 0 4px",
          fontSize: "var(--fs-item)",
          fontWeight: 700,
        }}
      >
        文字の大きさ
      </h2>
      <p
        style={{
          margin: "0 0 12px",
          fontSize: "var(--fs-sub)",
          color: "var(--ink-3)",
        }}
      >
        行間も一緒に変わります。選ぶと次からも同じ大きさで開きます。
      </p>

      <div role="radiogroup" aria-label="文字の大きさ" style={{ display: "flex", gap: 8 }}>
        {OPTIONS.map((o) => {
          const on = size === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => apply(o.value)}
              style={{
                flex: "1 1 0",
                minHeight: 48,
                borderRadius: 10,
                fontSize: "var(--fs-sub)",
                fontWeight: on ? 700 : 400,
                background: on ? "var(--accent-bg)" : "var(--surface)",
                border: on
                  ? "2px solid var(--accent)"
                  : "1px solid var(--border)",
                color: on ? "var(--accent-ink)" : "var(--ink)",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      <p
        style={{
          margin: "12px 0 0",
          paddingTop: 10,
          borderTop: "1px solid var(--border-soft)",
          fontSize: "var(--fs-note)",
          lineHeight: 1.75,
          color: "var(--ink-3)",
        }}
      >
        この3つで足りないときは、画面をピンチで拡大もできます（拡大は禁止していません）。ただし横スクロールが出るので、まずこの設定で足りるようにしています。
      </p>
    </section>
  );
}
