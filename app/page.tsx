import StorageCheck from "./storage-check";

/*
  下準備の段階。アプリの機能はまだ入っていない。
  画面設計のプレビューは https://claude.ai/artifact/B3o8PePPcKaho1aJKQqMfJ
  計画は docs/PLAN.md
*/

const done = [
  "サーバーを持たない形（静的書き出し）に設定",
  "GitHub Pages へ自動デプロイする設定",
  "ホーム画面に追加できる設定（アイコン・単独ウィンドウ）",
  "iPhone 内蔵フォントを使う設定（通信ゼロ）",
  "色の定義（欲しいもの用の6色を含む）",
  "保存状態を確認する仕組み（下のカード）",
];

const next = [
  "支出を記録する（金額だけ必須）",
  "今月の残りを出す",
  "サブスク（年額を主役に、累計も出す）",
  "サブスクの確認サイクル（続ける／解約を検討する）",
  "欲しいもの（あといくら・写真・買う理由と買わない理由）",
  "バックアップの書き出しと読み込み",
];

export default function Home() {
  return (
    <main
      style={{
        maxWidth: 430,
        margin: "0 auto",
        padding: "20px 20px 40px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <header>
        <h1
          style={{
            margin: 0,
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: "-0.01em",
          }}
        >
          moneyBAGS
        </h1>
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 14,
            lineHeight: 1.8,
            color: "var(--ink-3)",
          }}
        >
          下準備だけ終わった状態です。機能はまだ入っていません。
        </p>
      </header>

      <section
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: 16,
        }}
      >
        <h2 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 700 }}>
          できていること
        </h2>
        <ul
          style={{
            margin: 0,
            paddingLeft: 20,
            fontSize: 14,
            lineHeight: 1.95,
          }}
        >
          {done.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>

      <section
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: 16,
        }}
      >
        <h2 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 700 }}>
          これから作るもの
        </h2>
        <ol
          style={{
            margin: 0,
            paddingLeft: 20,
            fontSize: 14,
            lineHeight: 1.95,
          }}
        >
          {next.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
      </section>

      <section
        style={{
          background: "var(--attention-bg)",
          border: "1px solid var(--attention-edge)",
          borderRadius: 14,
          padding: 16,
          color: "var(--attention-ink)",
        }}
      >
        <h2 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700 }}>
          iPhone でアプリとして使うには
        </h2>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.85 }}>
          Safari でこのページを開き、下の共有ボタンから「ホーム画面に追加」を選んでください。iPhone
          は自分からは追加をすすめてこないので、手で行う必要があります。
        </p>
      </section>

      <StorageCheck />
    </main>
  );
}
