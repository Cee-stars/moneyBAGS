import type { MetadataRoute } from "next";

// output: "export" ではビルド時に1枚の静的ファイルとして書き出す必要がある
export const dynamic = "force-static";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/moneyBAGS";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "moneyBAGS 家計とサブスク",
    short_name: "moneyBAGS",
    description:
      "支出・サブスク・欲しいものを1つで管理する。データは端末の中だけに保存される。",
    lang: "ja",
    start_url: `${basePath}/`,
    scope: `${basePath}/`,
    display: "standalone",
    orientation: "portrait",
    background_color: "#F2F4F5",
    theme_color: "#F2F4F5",
    icons: [
      { src: `${basePath}/icon-192.png`, sizes: "192x192", type: "image/png" },
      { src: `${basePath}/icon-512.png`, sizes: "512x512", type: "image/png" },
      {
        src: `${basePath}/icon-512.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
