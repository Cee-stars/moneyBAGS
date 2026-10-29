/*
  画面の通し確認。実際のブラウザで記録の流れが動くかを見る。

  Playwright は依存に入れていない（CIのビルドを重くしないため）。
  使うときだけ入れる:

    npm install --no-save playwright
    npm run build
    node scripts/smoke.mjs

  静的書き出しは basePath 付きで配信されるので、out/ を
  moneyBAGS/ という名前で見せてから開く。
*/
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PORT = 4173;
const root = resolve(import.meta.dirname, "..");
const dir = mkdtempSync(join(tmpdir(), "mb-smoke-"));
symlinkSync(join(root, "out"), join(dir, "moneyBAGS"));

const server = spawn("python3", ["-m", "http.server", String(PORT), "--directory", dir], {
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 1500));

const BASE = `http://localhost:${PORT}/moneyBAGS/`;
const fail = (m) => { console.error('FAIL: ' + m); process.exitCode = 1; };
const ok = (m) => console.log('ok  - ' + m);

const browser = await chromium.launch();
// iPhone 相当の画面で確認する
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (await page.getByText('まず今月の予算を決めてください').isVisible()) ok('予算未設定の案内が出る');
  else fail('予算未設定の案内が出ない');

  // 予算を決める（全角で入力して、正規化が効くか同時に確かめる）
  await page.goto(BASE + 'settings/', { waitUntil: 'networkidle' });
  await page.getByLabel('今月の予算').fill('９０，０００円');
  await page.getByRole('button', { name: '予算を保存する' }).click();
  await page.waitForTimeout(400);
  const msg = await page.locator('[aria-live="polite"]').first().innerText();
  if (msg.includes('90,000円')) ok('全角「９０，０００円」が 90,000円 として保存される');
  else fail('予算の正規化が効いていない: ' + msg);

  // 1,280円 を記録する
  await page.goto(BASE + 'add/', { waitUntil: 'networkidle' });
  for (const k of ['1', '2', '8', '0']) await page.getByRole('button', { name: k, exact: true }).click();
  const shown = await page.locator('.money').innerText();
  if (shown.includes('1,280')) ok('テンキーで 1,280円 が出る');
  else fail('テンキーの表示がおかしい: ' + shown);

  await page.getByRole('button', { name: '外食' }).click();
  await page.getByRole('button', { name: /1,280円を記録する/ }).click();
  await page.waitForTimeout(400);
  if (await page.getByText('1,280円 を記録しました').isVisible()) ok('記録され、画面に残る');
  else fail('記録の確認が出ない');
  if ((await page.locator('.money').innerText()).includes('0円')) ok('金額だけ消えて続けて入力できる');
  else fail('保存後に金額が消えていない');

  // ホームに戻って残額を確かめる
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const money = await page.locator('.money').innerText();
  if (money.includes('88,720')) ok('残りが 88,720円 と出る（90,000 - 1,280）');
  else fail('残額の計算がおかしい: ' + money);
  const body = await page.locator('main').innerText();
  if (body.includes('記録があるのは 1日')) ok('記録の状況が正直に出る');
  else fail('記録の状況が出ない');
  if (body.includes('まだバックアップを書き出していません')) ok('バックアップ未実施の案内が出る');
  else fail('バックアップの案内が出ない');

  // 下書きが残るか（アプリを閉じて開き直す想定）
  await page.goto(BASE + 'add/', { waitUntil: 'networkidle' });
  for (const k of ['5', '0', '0']) await page.getByRole('button', { name: k, exact: true }).click();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  if ((await page.locator('.money').innerText()).includes('500')) ok('下書きが再読み込み後も残る');
  else fail('下書きが消えている');
} finally {
  server.kill();
  rmSync(dir, { recursive: true, force: true });
  if (errors.length) { console.error('JS エラー:', errors.join(' | ')); process.exitCode = 1; }
  await browser.close();
}
