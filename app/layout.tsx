import type { Metadata, Viewport } from "next";
import Background from "./background";
import "./globals.css";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/moneyBAGS";

export const metadata: Metadata = {
  title: "moneyBAGS",
  description:
    "支出・サブスク・欲しいものを1つで管理する。データは端末の中だけに保存される。",
  // ホーム画面に追加したときブラウザUIなしの単独ウィンドウで開く
  appleWebApp: {
    capable: true,
    title: "moneyBAGS",
    statusBarStyle: "default",
  },
  icons: {
    icon: `${basePath}/icon-192.png`,
    apple: `${basePath}/icon-192.png`,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 拡大を禁止しない。視覚のアクセシビリティのため maximumScale は 1 にしない。
  maximumScale: 5,
  userScalable: true,
  // ノッチ/ホームバー領域まで描けるようにする
  viewportFit: "cover",
  themeColor: "#F2F4F5",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body>
        {/*
          保存された文字サイズを最初の描画前に当てる。
          これがないと一瞬だけ標準サイズで出てから切り替わる。
          localStorage は private モードなどで例外を投げうるので必ず try で囲む。
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var t=localStorage.getItem("mb.textSize");if(t==="large"||t==="xlarge"){document.documentElement.dataset.text=t}' +
              // 花の枠は既定オン。オフにしている人の画面で最初の1フレームだけ
              // 花が出るのを防ぐ（正は IndexedDB 側 → app/background.tsx）。
              'if(localStorage.getItem("mb.flower")==="off"){document.documentElement.dataset.flower="off"}}catch(e){}',
          }}
        />
        {/*
          背景の3枚（写真・覆い・花の枠）。全画面に出す（本人の決定）。
          本文より前に置くのは、DOM の順番で重なりを決めているため
          （負の z-index を使わない）。詳細は app/background.tsx
        */}
        <Background />
        {children}
      </body>
    </html>
  );
}
