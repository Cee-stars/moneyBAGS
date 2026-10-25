import type { Metadata, Viewport } from "next";
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
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
