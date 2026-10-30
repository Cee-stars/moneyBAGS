/*
  背景写真の上で、文字が本当に読めるかを実測する。

  この機能で一番壊れやすいのがここなので、目視ではなく数値で確かめる。
  WCAG 1.4.3 の本文 4.5:1 を基準にする。

    npm install --no-save playwright
    npm run build
    node scripts/contrast-check.mjs

  測り方で2回間違えたので、その教訓をここに残しておく:

  1. **文字を消してから地を測る。** 文字を出したまま測ると、グリフの
     アンチエイリアスの中間色を「地の色」として拾ってしまい、実際には
     問題がないのに不合格に見える。
  2. **実際に適用されている色で測る。** 写真を敷くと CSS が文字色を
     --scrim-ink に差し替える。ソースに書いてある色（--ink や --accent）で
     計算すると、まったく別のものを測ることになる。

  やっていること: 画面に出ている「カードの外の文字」を1つずつ拾い、
  その要素の実際の色と、文字を消した状態の同じ場所の地の色を比べる。
  地の最悪の1点でも 4.5:1 を割ったら不合格。
*/
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtempSync, symlinkSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PORT = 4194;
const TARGET = 4.5;
const root = resolve(import.meta.dirname, "..");
const work = mkdtempSync(join(tmpdir(), "mb-contrast-"));
symlinkSync(join(root, "out"), join(work, "moneyBAGS"));

// 測りたい3種類の写真を作る。中身が分かっているほうが、落ちたときに原因を追える。
const imgDir = join(work, "img");
mkdirSync(imgDir);
const PHOTOS = {
  明るい写真: { base: "#eef3f8", blobs: ["#fff8e0", "#e2f0e6"] },
  暗い写真: { base: "#14181f", blobs: ["#243043", "#0d1116"] },
  // 文字の下に白と黒が同居する。覆いなしでは絶対に読めない作り。
  明暗が激しい写真: { base: "#ffffff", blobs: [] },
};

const server = spawn("python3", ["-m", "http.server", String(PORT), "--directory", work], {
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 1500));
const BASE = `http://localhost:${PORT}/moneyBAGS/`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ja-JP" });
const page = await ctx.newPage();
let failures = 0;

/** 画面写真の画素を読むための小さなページ。PNGの復号をブラウザに任せる。 */
const reader = await ctx.newPage();
await reader.setContent("<canvas id=c></canvas>");

async function worstContrastInBox(pngBase64, box, color, scale) {
  return reader.evaluate(
    async ([b64, b, col, s, target]) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = document.getElementById("c");
      c.width = img.width;
      c.height = img.height;
      const ctx2 = c.getContext("2d", { willReadFrequently: true });
      ctx2.drawImage(img, 0, 0);

      const lin = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
      const lum = (r, g, bl) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl);
      const Lt = lum(col[0], col[1], col[2]);
      const ratio = (L) => (Math.max(L, Lt) + 0.05) / (Math.min(L, Lt) + 0.05);

      const x0 = Math.max(0, Math.round(b.x * s));
      const y0 = Math.max(0, Math.round(b.y * s));
      const x1 = Math.min(c.width, Math.round((b.x + b.w) * s));
      const y1 = Math.min(c.height, Math.round((b.y + b.h) * s));
      if (x1 <= x0 || y1 <= y0) return null;

      const d = ctx2.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      let worst = Infinity;
      for (let i = 0; i < d.length; i += 4 * 2) {
        const r = ratio(lum(d[i], d[i + 1], d[i + 2]));
        if (r < worst) worst = r;
      }
      return worst;
    },
    [pngBase64, box, color, scale, TARGET],
  );
}

try {
  for (const [label, spec] of Object.entries(PHOTOS)) {
    // 写真を作る（SVG を読み込んで JPEG 化する代わりに、キャンバスで描いて Blob にする）
    const jpegB64 = await reader.evaluate(async (sp) => {
      const c = document.createElement("canvas");
      c.width = 1600;
      c.height = 1200;
      const x = c.getContext("2d");
      x.fillStyle = sp.base;
      x.fillRect(0, 0, 1600, 1200);
      if (sp.blobs.length === 0) {
        x.fillStyle = "#000000";
        x.fillRect(0, 0, 800, 1200);
        x.fillStyle = "#101010";
        x.fillRect(800, 600, 800, 600);
      } else {
        x.fillStyle = sp.blobs[0];
        x.beginPath();
        x.arc(400, 300, 260, 0, 7);
        x.fill();
        x.fillStyle = sp.blobs[1];
        x.beginPath();
        x.arc(1200, 800, 330, 0, 7);
        x.fill();
      }
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
      const buf = await blob.arrayBuffer();
      let s = "";
      const u = new Uint8Array(buf);
      for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
      return btoa(s);
    }, spec);
    const file = join(imgDir, `${encodeURIComponent(label)}.jpg`);
    writeFileSync(file, Buffer.from(jpegB64, "base64"));

    await page.goto(BASE + "settings/", { waitUntil: "networkidle" });
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles(file);
    await page.waitForTimeout(2200);
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    // カードの外にある文字だけを、実際に適用されている色つきで拾う
    const els = await page.evaluate(() => {
      const wrap = document.querySelector("main.wrap");
      if (!wrap) return [];
      const out = [];
      for (const el of wrap.children) {
        if (el.classList.contains("card") || el.classList.contains("btn")) continue;
        const walk = (node) => {
          if (node.nodeType === 3 && node.textContent.trim()) {
            const p = node.parentElement;
            const r = p.getBoundingClientRect();
            if (r.width > 4 && r.height > 4) {
              const m = getComputedStyle(p).color.match(/\d+/g).slice(0, 3).map(Number);
              out.push({
                text: node.textContent.trim().slice(0, 12),
                color: m,
                box: { x: r.x, y: r.y, w: r.width, h: r.height },
              });
            }
          }
          for (const c of node.childNodes) walk(c);
        };
        walk(el);
      }
      return out;
    });

    // 文字を消して地だけにする（教訓1）
    await page.addStyleTag({ content: "main *, header * { color: transparent !important; }" });
    await page.waitForTimeout(200);
    const png = (await page.screenshot()).toString("base64");
    const scale = 1;

    let worstAll = Infinity;
    let worstText = "";
    for (const e of els) {
      const w = await worstContrastInBox(png, e.box, e.color, scale);
      if (w !== null && w < worstAll) {
        worstAll = w;
        worstText = e.text;
      }
    }
    const ok = worstAll >= TARGET;
    if (!ok) failures++;
    console.log(
      `${ok ? "ok  " : "FAIL"} - ${label}：カードの外の文字 ${els.length}箇所、最悪 ${worstAll.toFixed(2)}:1（「${worstText}」）`,
    );
  }
} finally {
  await browser.close();
  server.kill();
  rmSync(work, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures}種類の写真で文字が ${TARGET}:1 を下回りました。`);
  process.exitCode = 1;
} else {
  console.log(`\nすべての写真で、カードの外の文字が ${TARGET}:1 以上でした。`);
}
