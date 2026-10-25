import type { NextConfig } from "next";

// GitHub Pages のプロジェクトページは https://<user>.github.io/<repo>/ で配信されるため
// basePath が必要。独自ドメインやユーザーページに移すときは
// NEXT_PUBLIC_BASE_PATH="" を渡して上書きする。
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/moneyBAGS";

const nextConfig: NextConfig = {
  // サーバーを持たない構成。全部を静的ファイルとして書き出す。
  output: "export",
  basePath,
  // 末尾スラッシュを付けると Pages の静的配信でパス解決がぶれない
  trailingSlash: true,
  images: {
    // 画像最適化はサーバー機能なので静的書き出しでは使えない
    unoptimized: true,
  },
};

export default nextConfig;
