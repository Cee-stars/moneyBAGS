/*
  記録を読み返す画面の通し確認。

    npm install --no-save playwright
    npm run build
    node scripts/smoke-history.mjs

  家計簿の本体は「1日に何へ何円使ったか」が後から見られること。
  入れる側だけ動いていても意味がないので、入れる→見る→直す→消すまで通す。
*/
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtempSync, symlinkSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PORT = 4195;
const root = resolve(import.meta.dirname, "..");
const SHOTS = join(root, ".shots");
mkdirSync(SHOTS, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), "mb-hist-"));
symlinkSync(join(root, "out"), join(dir, "moneyBAGS"));
const server = spawn("python3", ["-m", "http.server", String(PORT), "--directory", dir], {
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 1500));

const BASE = `http://localhost:${PORT}/moneyBAGS/`;
const fail = (m) => {
  console.error("FAIL: " + m);
  process.exitCode = 1;
};
const ok = (m) => console.log("ok  - " + m);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ja-JP" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const iso = (d) => {
  const t = new Date();
  t.setDate(t.getDate() - d);
  const p = (n) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
};

async function enter(digits, category, daysAgo) {
  await page.goto(BASE + "add/", { waitUntil: "networkidle" });
  if (daysAgo > 0) await page.locator("#date-pick").fill(iso(daysAgo));
  for (const k of digits) await page.getByRole("button", { name: k, exact: true }).click();
  await page.getByRole("button", { name: category, exact: true }).click();
  await page.getByRole("button", { name: /を記録する$/ }).click();
  await page.waitForTimeout(350);
}

try {
  await page.goto(BASE + "settings/", { waitUntil: "networkidle" });
  await page.getByLabel("今月の予算").fill("90000");
  await page.getByRole("button", { name: "予算を保存する" }).click();
  await page.waitForTimeout(350);

  // 同じ日に2件、別の日に1件。日ごとにまとまるかを見るため。
  await enter(["1", "2", "8", "0"], "外食", 0);
  await enter(["4", "5", "0"], "食費", 0);
  await enter(["3", "2", "0", "0"], "食費", 1);

  await page.goto(BASE + "history/", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const body = () => page.locator("main").innerText();

  let text = await body();
  if (text.includes("4,930円")) ok("月の合計が出る（1,280 + 450 + 3,200）");
  else fail("月の合計が出ない");

  if (text.includes("1,730円")) ok("その日の合計が出る（同じ日の2件をまとめる）");
  else fail("日ごとの合計が出ない");

  if (/食費[\s\S]*?（2件）/.test(text)) ok("分類ごとに件数と合計が出る");
  else fail("分類ごとの内訳が出ない");

  if (text.includes("外食") && text.includes("食費")) ok("何に使ったかが読み返せる");
  else fail("分類名が出ていない");

  if (text.includes("3件の記録")) ok("件数が出る");
  else fail("件数が出ない");

  await page.screenshot({ path: join(SHOTS, "history.png"), fullPage: true });

  // 直す。一覧の先頭の記録を開く（どれが来ても成り立つように実際の値から計算する）
  await page.getByRole("link", { name: "直す" }).first().click();
  await page.waitForTimeout(600);
  const shown = (await page.locator(".money").innerText()).replace(/[^\d]/g, "");
  if (shown !== "" && shown !== "0") ok(`直す画面に元の金額が入っている（${shown}円）`);
  else fail("元の金額が読み込まれない");

  // いったん全部消してから 500 円に直す
  for (let i = 0; i < 9; i++) await page.getByRole("button", { name: "1文字消す" }).click();
  for (const k of ["5", "0", "0"]) await page.getByRole("button", { name: k, exact: true }).click();
  await page.getByRole("button", { name: /に直す$/ }).click();
  await page.waitForTimeout(400);

  const expected = (4930 - Number(shown) + 500).toLocaleString("ja-JP") + "円";
  await page.goto(BASE + "history/", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  text = await body();
  if (text.includes(expected)) ok(`直した金額が合計に反映される（合計 ${expected}）`);
  else fail(`直した結果が反映されていない。${expected} を期待したが見つからない`);

  // 消す → 取り消す
  await page.getByRole("link", { name: "直す" }).first().click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "この記録を消す" }).click();
  await page.waitForTimeout(400);
  if (await page.getByText("の記録を消しました").isVisible()) ok("消したことが伝わる");
  else fail("消した表示が出ない");

  await page.getByRole("button", { name: "取り消す" }).click();
  await page.waitForTimeout(400);
  await page.goto(BASE + "history/", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  if ((await body()).includes("3件の記録")) ok("消したあと取り消すと戻る");
  else fail("取り消しても戻らない");

  // 前の月には記録がない
  await page.getByRole("button", { name: "前の月" }).click();
  await page.waitForTimeout(600);
  if ((await body()).includes("この月の記録はまだありません")) ok("記録のない月はその旨が出る");
  else fail("空の月の表示が出ない");

  // 1回進めば当月に戻る。当月では「次の月」は押せないはず。
  await page.getByRole("button", { name: "次の月" }).click();
  await page.waitForTimeout(600);
  const disabled = await page.getByRole("button", { name: "次の月" }).isDisabled();
  if (disabled) ok("先の月へは進めない");
  else fail("未来の月に進めてしまう");
} finally {
  if (errors.length) {
    console.error("JS エラー: " + errors.join(" | "));
    process.exitCode = 1;
  }
  await browser.close();
  server.kill();
  rmSync(dir, { recursive: true, force: true });
}
console.log("画面写真: " + SHOTS);
