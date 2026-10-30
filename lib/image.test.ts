import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fitWithin,
  coverPlacement,
  screenRectToImageRegion,
  buildStoredImage,
  parseStoredImage,
  formatBytes,
  MAX_LONG_EDGE,
  MAX_SHORT_EDGE,
} from "./image.ts";

test("大きい写真は上限まで縮む", () => {
  // 最近のiPhone写真。長辺が上限に合わせて縮み、縦横比は保たれる。
  const out = fitWithin({ width: 4032, height: 3024 });
  assert.ok(out.width <= MAX_LONG_EDGE && out.height <= MAX_SHORT_EDGE);
  assert.equal(out.width, MAX_LONG_EDGE);
  assert.ok(Math.abs(out.width / out.height - 4032 / 3024) < 0.01);
});

test("縦長でも長辺・短辺の上限を両方守る", () => {
  const out = fitWithin({ width: 3024, height: 4032 });
  assert.ok(Math.max(out.width, out.height) <= MAX_LONG_EDGE);
  assert.ok(Math.min(out.width, out.height) <= MAX_SHORT_EDGE);
});

test("小さい写真を引き伸ばさない（容量だけ増えて情報は増えないため）", () => {
  const src = { width: 320, height: 240 };
  assert.deepEqual(fitWithin(src), src);
});

test("大きさが不正なら例外", () => {
  assert.throws(() => fitWithin({ width: 0, height: 100 }));
  assert.throws(() => fitWithin({ width: -1, height: 100 }));
  assert.throws(() => fitWithin({ width: NaN, height: 100 }));
});

test("cover の配置：横長の画像は左右がはみ出す", () => {
  const place = coverPlacement({ width: 2000, height: 1000 }, { width: 390, height: 844 });
  assert.ok(place);
  assert.equal(place.scale, 844 / 1000);
  assert.ok(place.offsetX < 0, "左右にはみ出すので負のはず");
  assert.equal(place.offsetY, 0, "高さはぴったり合うので0");
});

test("cover の配置：縦長の画像は上下がはみ出す", () => {
  const place = coverPlacement({ width: 1000, height: 3000 }, { width: 390, height: 844 });
  assert.ok(place);
  assert.equal(place.scale, 390 / 1000);
  assert.equal(place.offsetX, 0);
  assert.ok(place.offsetY < 0);
});

test("cover の配置：使えない入力では null", () => {
  assert.equal(coverPlacement({ width: 0, height: 1 }, { width: 390, height: 844 }), null);
  assert.equal(coverPlacement({ width: 1, height: 1 }, { width: 0, height: 844 }), null);
});

/*
  ここが一番重要なテスト。
  cover で切り落とされた部分を測ってしまうと、画面に出ていない画素で覆いの濃さが
  決まり、「計算は通るのに実機で読めない」という最悪の壊れ方をする。
*/
test("画面の矩形が、実際に画面に出ている画素だけに対応する", () => {
  const image = { width: 2000, height: 1000 };
  const view = { width: 390, height: 844 };
  const region = screenRectToImageRegion({ x: 20, y: 100, width: 350, height: 200 }, image, view);
  assert.ok(region);

  // 横長の画像を縦長の画面に cover で敷くと、左右が大きく切れる。
  // 対応する領域は画像の中央付近で、左端(0)から始まってはいけない。
  assert.ok(region.x > 0, "左の切れた部分を含んではいけない");
  assert.ok(region.x + region.width <= image.width, "画像の外を含んではいけない");
  assert.ok(region.y + region.height <= image.height);

  // 実際の値（倍率0.844、左に649pxはみ出す配置）
  assert.equal(region.x, 792);
  assert.equal(region.y, 118);
  assert.equal(region.width, 416);
  assert.equal(region.height, 238);
});

test("余裕(pad)を足すと測る範囲が広がる（狭く測って覆いが足りないほうが危ない）", () => {
  const image = { width: 2000, height: 1000 };
  const view = { width: 390, height: 844 };
  const rect = { x: 20, y: 100, width: 350, height: 200 };
  const narrow = screenRectToImageRegion(rect, image, view, 0);
  const wide = screenRectToImageRegion(rect, image, view, 40);
  assert.ok(narrow && wide);
  assert.ok(wide.width > narrow.width);
  assert.ok(wide.height > narrow.height);
  assert.ok(wide.x <= narrow.x);
});

test("余裕を足しても画像の外には出ない", () => {
  const image = { width: 400, height: 900 };
  const view = { width: 390, height: 844 };
  const region = screenRectToImageRegion(
    { x: 0, y: 0, width: 390, height: 844 },
    image,
    view,
    9999,
  );
  assert.ok(region);
  assert.equal(region.x, 0);
  assert.equal(region.y, 0);
  assert.ok(region.x + region.width <= image.width);
  assert.ok(region.y + region.height <= image.height);
});

test("使えない入力では例外ではなく null（そのまま安全側に倒せる）", () => {
  const image = { width: 2000, height: 1000 };
  const view = { width: 390, height: 844 };
  assert.equal(screenRectToImageRegion({ x: 0, y: 0, width: 0, height: 10 }, image, view), null);
  assert.equal(screenRectToImageRegion({ x: NaN, y: 0, width: 10, height: 10 }, image, view), null);
  assert.equal(
    screenRectToImageRegion({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 1 }, view),
    null,
  );
});

test("保存する形を組み立てて読み戻せる", () => {
  const bytes = new ArrayBuffer(128);
  const stored = buildStoredImage(bytes, "image/jpeg", { width: 1600, height: 1200 });
  assert.equal(stored.type, "image/jpeg");
  assert.equal(stored.width, 1600);
  const back = parseStoredImage(stored);
  assert.ok(back);
  assert.equal(back.width, 1600);
  assert.equal(back.type, "image/jpeg");
});

test("返ってきた実際の形式を記録する（万一PNGが返っても嘘をつかない）", () => {
  const stored = buildStoredImage(new ArrayBuffer(8), "image/png", { width: 10, height: 10 });
  assert.equal(stored.type, "image/png");
});

test("空の中身や不正な大きさは受け付けない", () => {
  assert.throws(() => buildStoredImage(new ArrayBuffer(0), "image/jpeg", { width: 10, height: 10 }));
  assert.throws(() => buildStoredImage(new ArrayBuffer(8), "image/jpeg", { width: 0, height: 10 }));
});

test("壊れた保存データは null（画面を壊さない）", () => {
  assert.equal(parseStoredImage(null), null);
  assert.equal(parseStoredImage("なにか"), null);
  assert.equal(parseStoredImage({}), null);
  assert.equal(parseStoredImage({ bytes: new ArrayBuffer(8) }), null);
  assert.equal(
    parseStoredImage({ bytes: new ArrayBuffer(8), type: "text/plain", width: 1, height: 1 }),
    null,
  );
  // 大きさが欠けている / 整数でない / 0
  assert.equal(parseStoredImage({ bytes: new ArrayBuffer(8), type: "image/jpeg" }), null);
  assert.equal(
    parseStoredImage({ bytes: new ArrayBuffer(8), type: "image/jpeg", width: 1.5, height: 1 }),
    null,
  );
  assert.equal(
    parseStoredImage({ bytes: new ArrayBuffer(8), type: "image/jpeg", width: 0, height: 1 }),
    null,
  );
});

test("容量の表示", () => {
  assert.equal(formatBytes(512), "512 バイト");
  assert.equal(formatBytes(2048), "2 KB");
  assert.equal(formatBytes(1_500_000), "1.4 MB");
  assert.equal(formatBytes(-1), "不明");
  assert.equal(formatBytes(NaN), "不明");
});
