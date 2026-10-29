/*
  バックアップ。docs/PLAN.md §3.2

  この構成では、これが「おまけ」ではなく中核機能。
  iOS は7日間使わないとスクリプトから書けるストレージを削除することがあり、
  ホーム画面アプリでも消えたという報告がある。端末内保存を唯一の正に
  してはいけない。

  書き出せても読み込めないバックアップは意味がないので、復元も同じ重さで作る。
*/

import { getAllSettings, getAllTxns, putTxn, setSetting, type Txn } from "./db";

export const BACKUP_VERSION = 1;

export type Backup = {
  app: "moneyBAGS";
  version: number;
  exportedAt: string;
  txns: Txn[];
  settings: { key: string; value: unknown }[];
};

export async function buildBackup(): Promise<Backup> {
  const [txns, settings] = await Promise.all([getAllTxns(), getAllSettings()]);
  return {
    app: "moneyBAGS",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    txns,
    settings,
  };
}

export function backupFileName(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `moneybags-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`;
}

/** 読み込む前に形を確かめる。壊れたファイルで既存データを壊さないため。 */
export function parseBackup(text: string): { ok: true; data: Backup } | { ok: false; reason: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "ファイルの中身が読めませんでした。JSONではないようです。" };
  }
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, reason: "ファイルの形が違います。" };
  }
  const b = raw as Partial<Backup>;
  if (b.app !== "moneyBAGS") {
    return { ok: false, reason: "このアプリのバックアップファイルではないようです。" };
  }
  if (typeof b.version !== "number" || b.version > BACKUP_VERSION) {
    return { ok: false, reason: "新しいバージョンのファイルです。アプリを更新してください。" };
  }
  if (!Array.isArray(b.txns) || !Array.isArray(b.settings)) {
    return { ok: false, reason: "記録が入っていないファイルです。" };
  }
  for (const t of b.txns) {
    if (
      typeof t?.id !== "string" ||
      typeof t?.date !== "string" ||
      !Number.isInteger(t?.amountMinor)
    ) {
      return { ok: false, reason: "記録の中身が壊れています。読み込みを中止しました。" };
    }
  }
  return { ok: true, data: b as Backup };
}

export type RestoreResult = { added: number; replaced: number };

/*
  同じ id は上書き、ない id は追加。消しはしない。
  「読み込んだら今のデータが消えた」が一番やってはいけないこと。
*/
export async function restoreBackup(data: Backup): Promise<RestoreResult> {
  const existing = new Set((await getAllTxns()).map((t) => t.id));
  let added = 0;
  let replaced = 0;

  for (const t of data.txns) {
    if (existing.has(t.id)) replaced += 1;
    else added += 1;
    await putTxn(t);
  }
  for (const s of data.settings) {
    await setSetting(s.key, s.value);
  }
  return { added, replaced };
}
