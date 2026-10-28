import StorageCheck from "./storage-check";
import TextSize from "./text-size";

/*
  下準備の段階。アプリの機能はまだ入っていない。
  画面設計のプレビュー: https://claude.ai/artifact/B3o8PePPcKaho1aJKQqMfJ
  計画: docs/PLAN.md
*/

const done = [
  "サーバーを持たない形（静的書き出し）に設定",
  "GitHub Pages へ自動デプロイする設定",
  "ホーム画面に追加できる設定（アイコン・単独ウィンドウ）",
  "iPhone 内蔵フォントを使う設定（通信ゼロ）",
  "色の定義（欲しいもの用の6色を含む）",
  "文字の大きさ3段階（下のカード）",
  "保存状態を確認する仕組み（一番下のカード）",
];

const next = [
  "支出を記録する（金額だけ必須・「あとで分類する」も選べる）",
  "今月の残りを出す",
  "バックアップの書き出しと読み込み",
  "サブスク（年額を主役に、累計と件数も出す）",
  "サブスクの確認サイクル（続ける／解約を検討する・解約ページへのリンク）",
  "欲しいもの（あといくら・写真・買う理由と買わない理由）",
  "「今日はこれで終わり」で閉じられる画面",
];

const card: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 16,
};

const h2: React.CSSProperties = {
  margin: "0 0 10px",
  fontSize: "var(--fs-item)",
  fontWeight: 700,
};

const list: React.CSSProperties = {
  margin: 0,
  paddingLeft: "1.3em",
  fontSize: "var(--fs-body)",
  lineHeight: "var(--lh-body)",
};

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
            fontSize: "var(--fs-title)",
            fontWeight: 700,
            letterSpacing: "-0.01em",
            lineHeight: "var(--lh-tight)",
          }}
        >
          moneyBAGS
        </h1>
        <p
          style={{
            margin: "6px 0 0",
            fontSize: "var(--fs-body)",
            lineHeight: "var(--lh-body)",
            color: "var(--ink-3)",
          }}
        >
          下準備だけ終わった状態です。機能はまだ入っていません。
        </p>
      </header>

      <section style={card}>
        <h2 style={h2}>できていること</h2>
        <ul style={list}>
          {done.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>

      <section style={card}>
        <h2 style={h2}>これから作るもの</h2>
        <ol style={list}>
          {next.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
      </section>

      <section
        style={{
          ...card,
          background: "var(--attention-bg)",
          border: "1px solid var(--attention-edge)",
          color: "var(--attention-ink)",
        }}
      >
        <h2 style={h2}>iPhone でアプリとして使うには</h2>
        <p
          style={{
            margin: 0,
            fontSize: "var(--fs-body)",
            lineHeight: "var(--lh-body)",
          }}
        >
          Safari でこのページを開き、下の共有ボタンから「ホーム画面に追加」を選んでください。iPhone
          は自分からは追加をすすめてこないので、手で行う必要があります。
        </p>
      </section>

      <TextSize />
      <StorageCheck />
    </main>
  );
}
