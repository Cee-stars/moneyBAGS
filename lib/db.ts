/*
  保存層。docs/PLAN.md §3.1

  データは端末の中（IndexedDB）だけ。サーバーには送らない。
  ただし iOS は7日間使わないと消すことがあるので、これを唯一の正と
  見なしてはいけない。バックアップの書き出し（lib/backup.ts）が対になる。

  依存パッケージは使わない。必要なのは put / getAll / delete だけ。
*/

import type { CurrencyCode } from "./money.ts";
import { parseStoredImage, type StoredImage } from "./image.ts";

export const DB_NAME = "moneybags";
/*
  2 で image ストアを足した（背景写真）。
  上げるときは onupgradeneeded が「無いものだけ作る」形になっているか確かめる。
  version 1 のまま使っている端末からも、既存の txn / settings はそのまま残る。
*/
export const DB_VERSION = 2;

export const STORE = {
  txn: "txn",
  settings: "settings",
  image: "image",
} as const;

/*
  設定の鍵。背景まわりは複数のファイルから読むので、文字列を2箇所に書かない。
  （budgetMinor / lastBackupAt は先に文字列で書かれているのでそのままにしてある）
*/
export const SETTING_KEY = {
  flowerFrame: "flowerFrame",
  background: "background",
} as const;

/** 画像の鍵。背景は1枚だけなので固定の id を使う（差し替えは上書き）。 */
export const IMAGE_ID = {
  background: "background",
} as const;

export type Txn = {
  id: string;
  /** YYYY-MM-DD。暦日であって瞬間ではない。 */
  date: string;
  amountMinor: number;
  currency: CurrencyCode;
  /** null は「あとで分類する」。推測で埋めない（docs/PLAN.md §4.8）。 */
  categoryId: string | null;
  memo: string;
  createdAt: string;
  updatedAt: string;
};

export type SettingsRow = { key: string; value: unknown };

export function isAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

let cached: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (!isAvailable()) return Promise.reject(new Error("この環境では保存できません"));
  if (cached) return cached;

  cached = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE.txn)) {
        const txn = db.createObjectStore(STORE.txn, { keyPath: "id" });
        // 月の集計で必ず日付で絞るので、索引は最初から張る
        txn.createIndex("byDate", "date");
      }
      if (!db.objectStoreNames.contains(STORE.settings)) {
        db.createObjectStore(STORE.settings, { keyPath: "key" });
      }
      /*
        画像は settings と別のストアにする。設定は全件読み（getAllSettings）を
        バックアップでも画面でも使うので、そこに数百KBの ArrayBuffer を混ぜると
        設定を1つ読むたびに写真まで読むことになる。
      */
      if (!db.objectStoreNames.contains(STORE.image)) {
        db.createObjectStore(STORE.image, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("データベースを開けませんでした"));
  });
  cached.catch(() => {
    cached = null;
  });
  return cached;
}

function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const req = body(tx.objectStore(storeName));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("保存に失敗しました"));
      }),
  );
}

export const putTxn = (t: Txn) => run(STORE.txn, "readwrite", (s) => s.put(t));
export const deleteTxn = (id: string) => run(STORE.txn, "readwrite", (s) => s.delete(id));
export const getAllTxns = () => run<Txn[]>(STORE.txn, "readonly", (s) => s.getAll());

/** 1件だけ読む。記録を直す画面で使う。無ければ null。 */
export async function getTxn(id: string): Promise<Txn | null> {
  const t = await run<Txn | undefined>(STORE.txn, "readonly", (s) => s.get(id));
  return t ?? null;
}

/** 指定した期間の取引。索引を使うので全件走査しない。 */
export function getTxnsBetween(start: string, end: string): Promise<Txn[]> {
  return openDB().then(
    (db) =>
      new Promise<Txn[]>((resolve, reject) => {
        const tx = db.transaction(STORE.txn, "readonly");
        const req = tx
          .objectStore(STORE.txn)
          .index("byDate")
          .getAll(IDBKeyRange.bound(start, end));
        req.onsuccess = () => resolve(req.result as Txn[]);
        req.onerror = () => reject(req.error ?? new Error("読み込みに失敗しました"));
      }),
  );
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await run<SettingsRow | undefined>(STORE.settings, "readonly", (s) => s.get(key));
  return row === undefined ? fallback : (row.value as T);
}

export const setSetting = (key: string, value: unknown) =>
  run(STORE.settings, "readwrite", (s) => s.put({ key, value }));

export const getAllSettings = () =>
  run<SettingsRow[]>(STORE.settings, "readonly", (s) => s.getAll());

/* ---- 画像 ------------------------------------------------------------
  Blob を直接入れない。プライベートブラウズでは WebKit が意図的にエラーを返すので、
  { bytes: ArrayBuffer, type, width, height } の形で入れて、表示のときだけ
  Blob に組み立てる（lib/image.ts の storedImageToBlob）。
*/

export type ImageRow = StoredImage & { id: string };

export const putImage = (id: string, image: StoredImage) =>
  run(STORE.image, "readwrite", (s) => s.put({ id, ...image }));

export const deleteImage = (id: string) =>
  run(STORE.image, "readwrite", (s) => s.delete(id));

/** 形が違う行（古い保存・壊れた行）は null。呼び出し側は「写真なし」で動く。 */
export async function getImage(id: string): Promise<StoredImage | null> {
  const row = await run<ImageRow | undefined>(STORE.image, "readonly", (s) => s.get(id));
  return row === undefined ? null : parseStoredImage(row);
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/*
  消えにくい設定を要求する。iOS は利用履歴から自動で許可/不許可を決めるので
  プロンプトは出ない。許可されても安全の保証にはならない。
*/
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
