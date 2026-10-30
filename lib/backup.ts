/*
  バックアップ。docs/PLAN.md §3.2

  この構成では、これが「おまけ」ではなく中核機能。
  iOS は7日間使わないとスクリプトから書けるストレージを削除することがあり、
  ホーム画面アプリでも消えたという報告がある。端末内保存を唯一の正に
  してはいけない。

  書き出せても読み込めないバックアップは意味がないので、復元も同じ重さで作る。
*/

import { getAllSettings, getAllTxns, putTxn, setSetting, SETTING_KEY, type Txn } from "./db.ts";

export const BACKUP_VERSION = 1;

/*
  背景写真をバックアップに入れるか — 入れない（2026-10-30 決定）。

  決めた理由:

  1. **このファイルの仕事は記録を守ること。** 写真を入れると、JSON が数KBから
     数百KBに化ける。ArrayBuffer は JSON に入らないので base64 にすることになり、
     さらに約33%増える。書き出しは JSON.stringify で全文を1本の文字列にしてから
     File を作るので、iPhone の上で**記録の書き出しが写真のせいで重くなる・
     失敗しうる**。守る対象（記録）を、飾り（写真）のために危険にさらす交換は取らない。
  2. **docs/PLAN.md §4.4 が既に「写真はバックアップを本体と別ファイルにする」と
     決めている。** ここで本体に混ぜると、その決定を黙って覆すことになる。
  3. **失っても痛くない。** 背景写真は端末の中にある写真アプリから選び直せる。
     記録は選び直せない。非対称なものを同じ箱に入れない。

  そのうえで1つ手当てが要る。背景の**設定行**（覆いの濃さや文字色）は settings
  ストアにあるので、何もしないとバックアップに入ってしまう。それを別の端末で
  読み込むと「写真はあるはずなのに画像がない」状態になる。だから設定のほうも
  書き出しから外す（読み込み側でも落とす）。嘘の状態を復元しないため。

  写真そのものの持ち出しは、将来 §4.4 の「写真だけの別ファイル」としてここに足す。
  そのときも本体の JSON には混ぜない。
*/
const SKIP_SETTING_KEYS: readonly string[] = [SETTING_KEY.background];

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
    // 背景写真の設定は入れない（理由は SKIP_SETTING_KEYS のコメント）
    settings: settings.filter((s) => !SKIP_SETTING_KEYS.includes(s.key)),
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
    // 古い・手で編集したファイルに背景の設定が入っていても無視する。
    // 画像がない端末で「写真あり」の設定だけ入ると、嘘の状態になる。
    if (SKIP_SETTING_KEYS.includes(s.key)) continue;
    await setSetting(s.key, s.value);
  }
  return { added, replaced };
}
