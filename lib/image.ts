/*
  写真の取り込み。docs/PLAN.md §4.9「背景写真」と docs/research-ios-images.md

  サーバーがないので、縮小も変換も全部ブラウザの中でやる。原寸は保存しない。

  ここは「黙って壊れる」制約が集まっている場所なので、理由を全部書いておく。
  どれも iOS/WebKit の一次情報（WebKit のソースと MDN の互換データ）で
  確認済みの事実で、好みの問題ではない。

  1. **出力は JPEG。** iOS Safari は canvas.toBlob で WebP を出せない。
     しかも仕様上、未対応の形式を要求すると例外ではなく**黙って PNG を返す**。
     写真の PNG は JPEG の数倍になるので、気づかないまま容量を食う。
     だから形式は image/jpeg 固定で、戻ってきた blob.type も必ず確認する。

  2. **HEIC のデコーダは積まない。** WebKit のソース（WKFileUploadPanel.mm）では
     PhotoPickerPrefersOriginalImageFormat の既定が false なので、
     フォトライブラリから選んだ写真は accept の値に関係なく JPEG に変換されて届く。
     約500KBのwasmを積む価値がない。「ファイルを選択」から .heic を直接選んだ場合だけ
     デコードに失敗するので、そのときだけ利用者に分かる言葉で案内する（ImageError）。

  3. **accept に image/heic を書かない。** Safari 17+ に、書くと
     「JPEG を選んだのに .heic で届く」という逆向きのバグがある。入口は呼び出し側
     （app/settings/page.tsx）だが、ここに書いておかないと次に触る人が親切心で足す。

  4. **縮小用 canvas は1個だけ使い回し、使い終わったら 1×1 にする。**
     iOS には canvas の合計メモリ上限（報告値 224〜448MB）が別枠であり、
     参照を切っただけではすぐ解放されない。1×1 にするのが確実な返却方法。

  5. **createImageBitmap には imageOrientation: "from-image" を明示する。**
     WebKit は drawImage の時点で EXIF の回転を自動適用するので、
     自分でも回すと二重に回る。明示しておけば挙動が決まる。
     EXIF の位置情報は canvas で描き直した時点で落ちる（画素から再エンコードするため）。
     ICC プロファイルも落ちるので、Display P3 の写真は色がわずかに変わる。

  6. **IndexedDB に Blob を入れない。** プライベートブラウズでは WebKit が
     意図的にエラーを返す（仕様上の制約でバグではない）。
     { bytes: ArrayBuffer, type, width, height } の形で持ち、
     表示するときだけ Blob に組み立てる。保存は lib/db.ts、形はここ。

  ブラウザAPIに触らない計算（縮小後の大きさ、画面座標→画像座標、保存形の組み立て）は
  全部純関数にしてある。lib/image.test.ts がそこを見ている。
*/

import {
  measureBackground,
  planScrim,
  type BackgroundStats,
  type Region,
  type ScrimPlan,
} from "./readability.ts";

/* ---- 決めた数 -------------------------------------------------------- */

/*
  縮小後の大きさ。長辺 1600 / 短辺 1200 に収める（面積は最大 192万画素）。

  決めた理由:
  ・背景は画面いっぱいに cover で敷く。iPhone 14 Pro Max の実画素は 1290×2796 なので、
    「原寸相当」にするには長辺 2800 必要になる。ところが背景写真は必ず覆い（スクリム）
    の下に入るので、その鮮鋭さは画面に出ない。長辺 2800 は JPEG で 1MB を超えるが、
    1600 なら 300〜500KB に収まる。**4倍の容量を払って見えない差を買うことになる。**
  ・逆に 1000 を切ると、cover で引き伸ばしたときに輪郭のぼけが分かる（縦長画面に
    横向きの写真を敷くと 2倍以上に拡大される）。1600 はその手前。
  ・短辺に別の上限を置くのは、ほぼ正方形の写真で面積が 1600×1600=256万画素まで
    膨らむのを防ぐため。iOS の canvas 面積上限（16,777,216px）には遠く届かないが、
    メモリの合計上限は別枠なので、無駄に大きく取らない。
  ・原寸は保存しない（docs/PLAN.md §4.4）。背景は1枚しか持たないが、
    段4の「欲しいものの写真」で同じ処理を使うときは枚数が増える。
*/
export const MAX_LONG_EDGE = 1600;
export const MAX_SHORT_EDGE = 1200;

/*
  JPEG の品質。0.82 は「写真の空のような滑らかな階調でブロックが見えない」下限あたり。
  背景は覆いの下に入るのでこれで足りる。足りなければ下げる方向にだけ動かす（下を見よ）。
*/
export const JPEG_QUALITY = 0.82;

/** 品質を下げてでも収めたい上限。1枚 2MB。背景1枚＋将来の写真数十枚でも破綻しない。 */
export const MAX_STORED_BYTES = 2 * 1024 * 1024;

/** 上限を超えたときに試す品質。これでも超えたら受け取らない。 */
export const FALLBACK_QUALITY = 0.65;

/** iOS の canvas 面積上限（4096×4096 相当）。上の上限なら絶対に届かないが、番人として置く。 */
export const MAX_CANVAS_AREA = 16_777_216;

/** 入口の accept。image/heic を足してはいけない（上のコメント3）。 */
export const ACCEPT_IMAGE = "image/*";

export const IMAGE_TYPE = "image/jpeg";

/* ---- 大きさの計算（純関数） ------------------------------------------ */

export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

const isPositive = (v: number) => Number.isFinite(v) && v > 0;

/*
  長辺・短辺の上限に収まる大きさ。**拡大はしない**（小さい写真を引き伸ばしても
  情報は増えず容量だけ増える）。整数に丸めるので、縦横比はわずかにずれる。
  ずれは最大0.5px分で、cover で敷く背景では見えない。
*/
export function fitWithin(
  src: Size,
  longEdge: number = MAX_LONG_EDGE,
  shortEdge: number = MAX_SHORT_EDGE,
): Size {
  if (!isPositive(src.width) || !isPositive(src.height)) {
    throw new Error(`画像の大きさが不正です: ${src.width}x${src.height}`);
  }
  const long = Math.max(src.width, src.height);
  const short = Math.min(src.width, src.height);
  const scale = Math.min(1, longEdge / long, shortEdge / short);
  return {
    width: Math.max(1, Math.round(src.width * scale)),
    height: Math.max(1, Math.round(src.height * scale)),
  };
}

export type CoverPlacement = {
  /** 画像1pxが画面上で何pxになるか */
  scale: number;
  /** 画像の左上が画面のどこに来るか（cover なので 0 以下） */
  offsetX: number;
  offsetY: number;
};

/*
  background-size: cover + background-position: center と同じ配置を計算する。

  CSS がやっていることを JS で再現しているだけだが、**可読性の測定にはこれが要る。**
  cover は画面に入らない部分を切り落とすので、「画面のこの場所に文字が乗る」を
  「画像のどの画素を測るか」に直すには、この倍率とずらし量が必要になる。
  lib/readability.ts の設計者が「画面座標→画像座標の変換は呼び出し側の責任」と
  書いているのはこの部分。ここを間違えると、画面に出ていない画素を測って
  覆いの濃さを決めることになり、**計算は通るのに実機で読めない**という最悪の壊れ方をする。
*/
export function coverPlacement(image: Size, view: Size): CoverPlacement | null {
  if (!isPositive(image.width) || !isPositive(image.height)) return null;
  if (!isPositive(view.width) || !isPositive(view.height)) return null;
  const scale = Math.max(view.width / image.width, view.height / image.height);
  return {
    scale,
    offsetX: (view.width - image.width * scale) / 2,
    offsetY: (view.height - image.height * scale) / 2,
  };
}

/*
  画面上の矩形（CSS px）を、cover で敷いた画像の画素座標に直す。

  ・pad は画面px単位の余裕。アドレスバーの出入りで画面の高さが数十px変わる・
    スクロールで文字の位置が少し動く、といった「測ったときと本番でずれる」分を
    外側に広げて吸収する。狭く測って足りない覆いを選ぶほうが危ないので、
    迷ったら広い側に倒す。
  ・画像の外に出た分は切り詰める。cover なので画面の端は必ず画像の内側にあるが、
    pad を足すと外に出ることがある。
  ・使えない入力では例外ではなく null を返す（readability.ts と同じ構え）。
    null をそのまま planScrim(null) に渡せば安全側（通常のカード）に倒れる。
*/
export function screenRectToImageRegion(
  rect: Rect,
  image: Size,
  view: Size,
  pad = 0,
): Region | null {
  const place = coverPlacement(image, view);
  if (!place) return null;
  if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y)) return null;
  if (!isPositive(rect.width) || !isPositive(rect.height)) return null;

  const p = Math.max(0, Number.isFinite(pad) ? pad : 0);
  const toImageX = (sx: number) => (sx - place.offsetX) / place.scale;
  const toImageY = (sy: number) => (sy - place.offsetY) / place.scale;

  const x0 = Math.max(0, Math.floor(toImageX(rect.x - p)));
  const y0 = Math.max(0, Math.floor(toImageY(rect.y - p)));
  const x1 = Math.min(image.width, Math.ceil(toImageX(rect.x + rect.width + p)));
  const y1 = Math.min(image.height, Math.ceil(toImageY(rect.y + rect.height + p)));

  const width = x1 - x0;
  const height = y1 - y0;
  if (width < 1 || height < 1) return null;
  return { x: x0, y: y0, width, height };
}

/* ---- 保存する形（純関数） -------------------------------------------- */

/*
  IndexedDB に入れる形。Blob を直接入れない理由は上のコメント6。
  width/height も一緒に持つのは、表示のたびに画像をデコードして測り直さないため
  （可読性の測定領域の計算に大きさが必要で、そのために1枚デコードするのは無駄）。
*/
export type StoredImage = {
  bytes: ArrayBuffer;
  type: string;
  width: number;
  height: number;
};

export function buildStoredImage(
  bytes: ArrayBuffer,
  type: string,
  size: Size,
): StoredImage {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0) {
    throw new Error("画像の中身が空です");
  }
  if (!isPositive(size.width) || !isPositive(size.height)) {
    throw new Error(`画像の大きさが不正です: ${size.width}x${size.height}`);
  }
  return {
    bytes,
    // 受け取った実際の型を書く。要求した型を書くと、万一 PNG が返ってきたときに
    // Blob の型が嘘になって表示が壊れる（上のコメント1）。
    type: type || IMAGE_TYPE,
    width: Math.round(size.width),
    height: Math.round(size.height),
  };
}

/*
  保存から読んだものを確かめる。古い形・壊れた行で画面を壊さないため、
  読めなければ null（呼び出し側は「写真なし」として動く）。
*/
export function parseStoredImage(raw: unknown): StoredImage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Partial<StoredImage>;
  if (!(r.bytes instanceof ArrayBuffer) || r.bytes.byteLength === 0) return null;
  if (typeof r.type !== "string" || !r.type.startsWith("image/")) return null;
  // 先に number へ絞ってから中身を見る。Number.isInteger は型を絞らないので、
  // ここで typeof を通さないと undefined が下まで素通りする。
  const { width, height } = r;
  if (typeof width !== "number" || typeof height !== "number") return null;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (!isPositive(width) || !isPositive(height)) return null;
  return { bytes: r.bytes, type: r.type, width, height };
}

/** 表示のときだけ Blob に戻す。URL.createObjectURL はこの Blob から作る。 */
export function storedImageToBlob(image: StoredImage): Blob {
  return new Blob([image.bytes], { type: image.type });
}

/** 容量の表示。利用者に見せる文字列なので日本語の単位感に寄せる（小数は1桁まで）。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "不明";
  if (bytes < 1024) return `${Math.round(bytes)} バイト`;
  const kb = bytes / 1024;
  if (kb < 1000) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${(Math.round(mb * 10) / 10).toFixed(1)} MB`;
}

/* ---- ここから下はブラウザが要る ------------------------------------- */

/** 利用者にそのまま見せる文章を持つエラー。技術用語を画面に出さないため。 */
export class ImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageError";
  }
}

/*
  縮小用の canvas は1個だけ持つ（上のコメント4）。
  使い終わったら必ず 1×1 に縮める。要素じたいは捨てずに取っておく。
  （毎回 createElement すると、解放待ちの canvas が増える時間帯ができる）
*/
let shared: HTMLCanvasElement | null = null;

function acquireCanvas(width: number, height: number): CanvasRenderingContext2D {
  if (width * height > MAX_CANVAS_AREA) {
    throw new ImageError("写真が大きすぎて読み込めませんでした。");
  }
  if (!shared) shared = document.createElement("canvas");
  shared.width = width;
  shared.height = height;
  // alpha を切ると背景に黒が敷かれて JPEG の端が暗くなる環境があるので既定のまま使う
  const ctx = shared.getContext("2d");
  if (!ctx) throw new ImageError("この端末では写真を変換できませんでした。");
  return ctx;
}

/** canvas のメモリを返す。失敗しても呼べるように finally から呼ぶ。 */
function releaseCanvas(): void {
  if (!shared) return;
  shared.width = 1;
  shared.height = 1;
}

function toBlobAsync(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), IMAGE_TYPE, quality);
  });
}

/*
  ファイルをデコードする。失敗する現実的な原因は「ファイルを選択」から
  iCloud Drive の .heic を直接選んだ場合だけ（上のコメント2）。
  なので案内文は「写真アプリから選び直す」に寄せる。原因の推測は書かない。
*/
async function decode(file: File): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== "function") {
    throw new ImageError("この端末では写真を読み込めませんでした。");
  }
  try {
    // 回転は WebKit が drawImage で自動適用する。明示して挙動を固定する（コメント5）。
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ImageError(
      "この写真は読み込めませんでした。写真アプリの「フォトライブラリ」から選び直してください。",
    );
  }
}

export type PreparedBackground = {
  stored: StoredImage;
  /** 文字が乗る場所の明るさ。読めなかったときは null */
  stats: BackgroundStats | null;
  /** 測った領域（画像の画素座標）。診断用 */
  region: Region | null;
  /** 覆いと文字色の計画。これを設定と一緒に保存して、毎回計算し直さない */
  plan: ScrimPlan;
  /** 保存するバイト数 */
  bytes: number;
  /** 実際に使った JPEG の品質 */
  quality: number;
};

export type MeasureTarget = {
  /** 測るときの画面の大きさ（CSS px） */
  view: Size;
  /** 文字が乗る範囲（画面座標・CSS px）。省略時は画面全体 */
  textRect?: Rect;
  /** 測る範囲を外側に広げる余裕（画面px） */
  pad?: number;
};

/*
  写真1枚を「背景に使える形」にする。縮小 → 測る → JPEG に変換、まで。
  保存はしない（保存は lib/db.ts、呼ぶのは app/settings/page.tsx）。

  測るのは**この1回だけ**。毎フレームも、画面を開くたびでもない。
  結果（plan）を設定と一緒に保存して使い回す（docs/PLAN.md §4.9）。
*/
export async function prepareBackground(
  file: File,
  target: MeasureTarget,
): Promise<PreparedBackground> {
  const bitmap = await decode(file);
  const size = fitWithin({ width: bitmap.width, height: bitmap.height });

  try {
    const ctx = acquireCanvas(size.width, size.height);
    // 1段で縮める。段階的な半分ずつの縮小より輪郭は甘くなるが、
    // 背景は覆いの下に入るので差が画面に出ない。canvas を1個に保つほうを採る。
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);

    /*
      測る領域を決める。ここが一番の落とし穴（coverPlacement のコメント参照）。
      画面座標の「文字が乗る場所」を、cover で切られたあとの画像座標に直す。
    */
    const rect: Rect = target.textRect ?? {
      x: 0,
      y: 0,
      width: target.view.width,
      height: target.view.height,
    };
    const region = screenRectToImageRegion(rect, size, target.view, target.pad ?? 0);

    let stats: BackgroundStats | null = null;
    if (region) {
      try {
        const data = ctx.getImageData(region.x, region.y, region.width, region.height);
        stats = measureBackground(data.data, data.width, data.height);
      } catch {
        // 測れなかったときは null のまま。planScrim(null) が安全側に倒してくれる。
        stats = null;
      }
    }
    const plan = planScrim(stats);

    // 2MB を超えたら品質を落として1回だけ試す。canvas はまだ生きているので安い。
    let blob: Blob | null = null;
    let quality = JPEG_QUALITY;
    for (const q of [JPEG_QUALITY, FALLBACK_QUALITY]) {
      blob = await toBlobAsync(shared!, q);
      quality = q;
      if (blob && blob.size <= MAX_STORED_BYTES) break;
    }
    if (!blob) throw new ImageError("写真を変換できませんでした。");
    if (blob.size > MAX_STORED_BYTES) {
      throw new ImageError(
        `この写真は変換しても ${formatBytes(blob.size)} あり、保存できる大きさ（${formatBytes(MAX_STORED_BYTES)}）を超えています。`,
      );
    }
    /*
      要求した形式で返ってきたか必ず見る。iOS は未対応の形式を要求されると
      例外ではなく黙って PNG を返す（コメント1）。JPEG を要求しているので
      普通は起きないが、起きたら容量が数倍になるので気づける場所を作っておく。
    */
    if (blob.type !== IMAGE_TYPE) {
      console.warn(`JPEG を要求したのに ${blob.type} が返りました`);
    }

    const bytes = await blob.arrayBuffer();
    return {
      stored: buildStoredImage(bytes, blob.type, size),
      stats,
      region,
      plan,
      bytes: bytes.byteLength,
      quality,
    };
  } finally {
    bitmap.close();
    releaseCanvas();
  }
}

/*
  容量のめやす。navigator.storage.estimate() は **iOS 17 以降にしかなく**、
  非現実的な値を返す報告もある。だから存在チェックと try/catch を入れ、
  **UI の制御には使わない**（参考表示だけ）。実際の限界は保存時の
  QuotaExceededError で扱う（docs/research-ios-images.md 5-3）。
*/
export async function estimateUsage(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    if (typeof e.usage !== "number" || typeof e.quota !== "number") return null;
    return { usage: e.usage, quota: e.quota };
  } catch {
    return null;
  }
}
