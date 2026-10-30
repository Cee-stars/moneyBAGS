import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseHexColor,
  toHexColor,
  toCssColor,
  relativeLuminance,
  contrastRatio,
  grayForLuminance,
  compositeOver,
  measureBackground,
  minScrimOpacity,
  planScrim,
  COLOR,
  PALETTE,
  TARGET_BODY,
  TARGET_LARGE,
  SAFETY_MARGIN,
  MAX_SCRIM_OPACITY,
  type Rgb,
} from "./readability.ts";

/*
  テスト用の道具。

  mix と lum は実装とは別に、ここでもう一度素朴に書いている。
  「スクリムをかけたら本当に 4.5:1 以上になるか」を、実装と同じ関数で
  検算しても意味が薄いため。式を2回別々に書いて一致することを確かめる。
*/
function mix(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  const ch = (t: number, b: number) => Math.round(alpha * t + (1 - alpha) * b);
  return { r: ch(top.r, bottom.r), g: ch(top.g, bottom.g), b: ch(top.b, bottom.b) };
}

function lum(c: Rgb): number {
  const f = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
  return (hi + 0.05) / (lo + 0.05);
}

/** 単色で塗った RGBA を作る。 */
function solidImage(width: number, height: number, c: Rgb, alpha = 255): Uint8ClampedArray {
  const px = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    px[i * 4] = c.r;
    px[i * 4 + 1] = c.g;
    px[i * 4 + 2] = c.b;
    px[i * 4 + 3] = alpha;
  }
  return px;
}

/** 左半分 left・右半分 right の RGBA を作る。 */
function halfImage(width: number, height: number, left: Rgb, right: Rgb): Uint8ClampedArray {
  const px = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = x < width / 2 ? left : right;
      const i = (y * width + x) * 4;
      px[i] = c.r;
      px[i + 1] = c.g;
      px[i + 2] = c.b;
      px[i + 3] = 255;
    }
  }
  return px;
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const MID: Rgb = { r: 128, g: 128, b: 128 };

/* ---- コントラスト比の計算 ---------------------------------------------- */

test("色の読み取り（#rgb の省略形も受ける）", () => {
  assert.deepEqual(parseHexColor("#19222a"), { r: 25, g: 34, b: 42 });
  assert.deepEqual(parseHexColor("#FFF"), { r: 255, g: 255, b: 255 });
  assert.equal(toHexColor({ r: 25, g: 34, b: 42 }), "#19222a");
  assert.throws(() => parseHexColor("rgb(0,0,0)"));
  assert.throws(() => parseHexColor("#12345"));
});

test("既知のコントラスト比が出る（黒と白は 21:1）", () => {
  assert.equal(contrastRatio(BLACK, WHITE), 21);
  // 向きを入れ替えても同じ
  assert.equal(contrastRatio(WHITE, BLACK), 21);
  // 同じ色どうしは 1:1
  assert.equal(contrastRatio(MID, MID), 1);
});

test("既知のコントラスト比が出る（--ink-3 #5a6872 は白地で約 5.7:1）", () => {
  assert.ok(Math.abs(contrastRatio(COLOR.ink3, WHITE) - 5.74) < 0.02);
  // 実際に使う地色は純白ではなく --surface。わずかに下がる
  assert.ok(Math.abs(contrastRatio(COLOR.ink3, COLOR.surface) - 5.64) < 0.02);
  // 本文色は --surface の上で 15:1 以上（§4.6 の「コントラストは落とさない」）
  assert.ok(contrastRatio(COLOR.ink, COLOR.surface) > 15);
  // --accent 上の白文字（.btn.primary）も本文基準を満たす
  assert.ok(contrastRatio(parseHexColor("#1f6b7a"), WHITE) >= TARGET_BODY);
});

test("相対輝度は 0..1 で、白が 1・黒が 0", () => {
  assert.equal(relativeLuminance(BLACK), 0);
  assert.equal(relativeLuminance(WHITE), 1);
  // 中間グレー #808080 の輝度は 0.216 付近（ガンマがあるので 0.5 ではない）
  assert.ok(Math.abs(relativeLuminance(MID) - 0.2159) < 0.001);
});

test("輝度からグレーに戻せる（往復してほぼ元に戻る）", () => {
  for (const l of [0, 0.05, 0.2159, 0.5, 1]) {
    assert.ok(Math.abs(relativeLuminance(grayForLuminance(l)) - l) < 0.01);
  }
});

test("合成は sRGB のまま線形に混ざる（CSS の alpha 合成と同じ）", () => {
  assert.deepEqual(compositeOver(WHITE, 0, BLACK), BLACK);
  assert.deepEqual(compositeOver(WHITE, 1, BLACK), WHITE);
  assert.deepEqual(compositeOver(WHITE, 0.5, BLACK), { r: 128, g: 128, b: 128 });
  // 別に書いた素朴な実装と一致する
  assert.deepEqual(compositeOver(COLOR.surface, 0.37, MID), mix(COLOR.surface, 0.37, MID));
});

/* ---- 画像の明るさを測る ------------------------------------------------ */

test("間引きサンプリング: 全画素を舐めない", () => {
  const stats = measureBackground(solidImage(400, 400, MID), 400, 400);
  assert.ok(stats);
  // 16万画素あっても 2000 標本程度しか見ない
  assert.ok(stats.sampleCount <= 2600, `標本が多すぎる: ${stats.sampleCount}`);
  assert.ok(stats.step > 1);
  // 小さい画像は間引かない
  const small = measureBackground(solidImage(10, 10, MID), 10, 10);
  assert.equal(small?.step, 1);
  assert.equal(small?.sampleCount, 100);
});

test("平坦な画像はばらつき 0、明暗差 1:1", () => {
  const stats = measureBackground(solidImage(64, 64, MID), 64, 64);
  assert.ok(stats);
  assert.ok(Math.abs(stats.meanLuminance - 0.2159) < 0.001);
  // 浮動小数点なのでぴったり 0 にはならない（1e-14 程度）。ゼロと言える範囲か見る
  assert.ok(stats.stdDevLuminance < 1e-9, `ばらつき: ${stats.stdDevLuminance}`);
  assert.equal(stats.edgeContrast, 1);
  assert.deepEqual(stats.darkEdge, MID);
  assert.deepEqual(stats.brightEdge, MID);
});

test("半分白・半分黒: 平均は中間でも、ばらつきと明暗差で検出される", () => {
  const stats = measureBackground(halfImage(64, 64, BLACK, WHITE), 64, 64);
  assert.ok(stats);
  // 平均輝度は 0.5 付近 = 中間グレーと区別がつかない
  assert.ok(Math.abs(stats.meanLuminance - 0.5) < 0.02);
  // ばらつきで区別がつく
  assert.ok(stats.stdDevLuminance > 0.4);
  // 背景じたいの明暗差が 21:1（どんな単色の文字も片側で落ちる）
  assert.ok(stats.edgeContrast > 20);
  assert.deepEqual(stats.darkEdge, BLACK);
  assert.deepEqual(stats.brightEdge, WHITE);
});

test("文字が乗る領域だけを測れる", () => {
  const px = halfImage(64, 64, BLACK, WHITE);
  const left = measureBackground(px, 64, 64, { region: { x: 0, y: 0, width: 32, height: 64 } });
  assert.equal(left?.meanLuminance, 0);
  const right = measureBackground(px, 64, 64, { region: { x: 32, y: 0, width: 32, height: 64 } });
  assert.equal(right?.meanLuminance, 1);
  // はみ出した領域は画像内に収める
  const over = measureBackground(px, 64, 64, { region: { x: 60, y: 60, width: 999, height: 999 } });
  assert.ok(over);
  assert.equal(over.meanLuminance, 1);
});

test("透過ピクセルはアプリの地色の上に合成して扱う（真っ黒と読み違えない）", () => {
  // 完全透過の画素データは 0,0,0,0。alpha を無視すると真っ黒に見える
  const stats = measureBackground(solidImage(32, 32, BLACK, 0), 32, 32);
  assert.ok(stats);
  assert.deepEqual(stats.meanColor, COLOR.bg);
  assert.ok(stats.meanLuminance > 0.8);
});

test("使えない入力では落ちずに null を返す", () => {
  assert.equal(measureBackground(new Uint8ClampedArray(0), 0, 0), null);
  assert.equal(measureBackground(new Uint8ClampedArray(0), 10, 10), null);
  // 宣言したサイズに対してデータが足りない
  assert.equal(measureBackground(new Uint8ClampedArray(4 * 10), 10, 10), null);
  assert.equal(measureBackground(solidImage(4, 4, MID), -4, 4), null);
  assert.equal(measureBackground(solidImage(4, 4, MID), 4.5, 4), null);
  // 面積ゼロの領域
  assert.equal(
    measureBackground(solidImage(8, 8, MID), 8, 8, { region: { x: 0, y: 0, width: 0, height: 8 } }),
    null,
  );
  assert.equal(
    measureBackground(solidImage(8, 8, MID), 8, 8, { region: { x: 99, y: 0, width: 8, height: 8 } }),
    null,
  );
  assert.equal(
    measureBackground(solidImage(8, 8, MID), 8, 8, {
      region: { x: 0, y: 0, width: Number.NaN, height: 8 },
    }),
    null,
  );
});

/* ---- スクリムの不透明度 ------------------------------------------------ */

test("覆いが要らない背景には 0 を返す", () => {
  const r = minScrimOpacity(COLOR.surface, COLOR.ink);
  assert.equal(r.opacity, 0);
  assert.ok(r.meetsTarget);
});

test("真っ黒な背景に濃い文字: 明るい覆いが半分ほど必要", () => {
  const r = minScrimOpacity(BLACK, COLOR.ink);
  assert.ok(r.meetsTarget);
  assert.deepEqual(r.scrimColor, COLOR.surface, "濃い文字には明るい覆いを選ぶ");
  assert.ok(r.opacity > 0.45 && r.opacity < 0.65, `想定外の不透明度: ${r.opacity}`);
});

test("真っ白な背景に薄い文字: 暗い覆いが必要", () => {
  const r = minScrimOpacity(WHITE, COLOR.surface);
  assert.ok(r.meetsTarget);
  assert.deepEqual(r.scrimColor, COLOR.ink, "薄い文字には暗い覆いを選ぶ");
  assert.ok(r.opacity > 0.5 && r.opacity <= MAX_SCRIM_OPACITY);
});

test("中間の灰色: どちらの文字色でも覆いは薄くて済む", () => {
  const dark = minScrimOpacity(MID, COLOR.ink);
  const light = minScrimOpacity(MID, COLOR.surface);
  assert.ok(dark.meetsTarget && light.meetsTarget);
  assert.ok(dark.opacity > 0 && dark.opacity < 0.5, `濃い文字: ${dark.opacity}`);
  assert.ok(light.opacity > 0 && light.opacity < 0.6, `薄い文字: ${light.opacity}`);
});

/*
  最小であることの確認。実装は 4.5 ではなく 4.5 + SAFETY_MARGIN を狙うので、
  「1段薄くすると 4.5 を割る」ではなく「狙っている値を割る」で判定する。
  余裕ぶん（0.02）は 8bit とブラウザの合成精度のための保険で、意図した上乗せ。
*/
test("最小であること: 1段薄くすると狙いの比率に届かない", () => {
  const aim = TARGET_BODY + SAFETY_MARGIN;
  for (const bg of [BLACK, WHITE, MID, { r: 90, g: 140, b: 60 }, { r: 200, g: 60, b: 90 }]) {
    for (const text of [COLOR.ink, COLOR.surface, COLOR.ink3]) {
      const r = minScrimOpacity(bg, text);
      if (!r.meetsTarget || r.opacity === 0) continue;
      const weaker = Number((r.opacity - 0.01).toFixed(4));
      const got = ratio(text, mix(r.scrimColor, weaker, bg));
      assert.ok(got < aim, `${toHexColor(bg)} は ${weaker} でも足りている（${got.toFixed(3)}:1）`);
      // 覆いすぎてもいない。1段薄い値は 4.5 を大きく下回らない範囲に収まる
      assert.ok(got > TARGET_BODY - 0.3, `${toHexColor(bg)} は覆いすぎ（${got.toFixed(3)}:1）`);
    }
  }
});

test("大きな文字（3:1）なら覆いは薄くなる", () => {
  const body = minScrimOpacity(BLACK, COLOR.ink, { targetRatio: TARGET_BODY });
  const large = minScrimOpacity(BLACK, COLOR.ink, { targetRatio: TARGET_LARGE });
  assert.ok(large.opacity < body.opacity);
  assert.ok(ratio(COLOR.ink, mix(large.scrimColor, large.opacity, BLACK)) >= TARGET_LARGE);
});

test("上限を超えて必要なときは meetsTarget が false になる（黙って足りない値を返さない）", () => {
  // --surface の文字に --surface の覆い（組み合わせとして間違い）は何をしても届かない
  const r = minScrimOpacity(WHITE, COLOR.surface, { scrimColor: COLOR.surface });
  assert.equal(r.meetsTarget, false);
  assert.ok(r.opacity <= MAX_SCRIM_OPACITY);
  // 上限を 0 にすれば当然届かない
  const capped = minScrimOpacity(BLACK, COLOR.ink, { maxOpacity: 0 });
  assert.equal(capped.meetsTarget, false);
  assert.equal(capped.opacity, 0);
});

/* ---- 一番大事なテスト: 返した値で本当に 4.5:1 以上になるか -------------- */

test("どんな背景色でも、返した覆いをかけた後のコントラストが 4.5:1 以上になる", () => {
  // 0..255 を粗く全組み合わせ（6^3 = 216 色）。実装とは別に書いた式で検算する。
  const levels = [0, 51, 102, 153, 204, 255];
  let checked = 0;
  for (const r of levels) {
    for (const g of levels) {
      for (const b of levels) {
        const bg = { r, g, b };
        for (const text of [COLOR.ink, COLOR.surface, COLOR.ink3]) {
          const solved = minScrimOpacity(bg, text);
          if (!solved.meetsTarget) continue;
          const after = mix(solved.scrimColor, solved.opacity, bg);
          const got = ratio(text, after);
          assert.ok(
            got >= TARGET_BODY,
            `${toHexColor(bg)} に ${toHexColor(text)}: 不透明度 ${solved.opacity} で ${got.toFixed(3)}:1`,
          );
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 500, `検証した組み合わせが少なすぎる: ${checked}`);
});

test("実画像から立てた計画でも、合成後のコントラストが 4.5:1 以上になる", () => {
  const cases: [string, Uint8ClampedArray][] = [
    ["真っ白", solidImage(48, 48, WHITE)],
    ["真っ黒", solidImage(48, 48, BLACK)],
    ["中間の灰色", solidImage(48, 48, MID)],
    ["アプリの地色", solidImage(48, 48, COLOR.bg)],
    ["半分白・半分黒", halfImage(48, 48, BLACK, WHITE)],
    ["濃い青と薄い黄", halfImage(48, 48, { r: 10, g: 20, b: 120 }, { r: 250, g: 240, b: 160 })],
    ["彩度の高い赤単色", solidImage(48, 48, { r: 220, g: 20, b: 40 })],
    ["彩度の高い青単色", solidImage(48, 48, { r: 0, g: 0, b: 255 })],
  ];

  for (const [name, px] of cases) {
    const stats = measureBackground(px, 48, 48);
    assert.ok(stats, name);
    const plan = planScrim(stats);
    const text = parseHexColor(plan.textColor);
    const scrim = parseHexColor(plan.scrimColor);

    // 代表3点すべてで 4.5:1 以上
    for (const probe of [stats.darkEdge, stats.median, stats.brightEdge]) {
      const got = ratio(text, mix(scrim, plan.opacity, probe));
      assert.ok(
        got >= TARGET_BODY,
        `${name}: ${toHexColor(probe)} の上で ${got.toFixed(3)}:1（不透明度 ${plan.opacity}）`,
      );
    }
    // 申告している worstContrast が実測より甘くない（過大申告しない）
    assert.ok(plan.worstContrast >= TARGET_BODY, name);
    assert.ok(plan.opacity <= MAX_SCRIM_OPACITY || plan.fallbackToSurface, name);
  }
});

/* ---- 計画の中身 -------------------------------------------------------- */

test("真っ白な背景は濃い文字・覆いなし", () => {
  const plan = planScrim(measureBackground(solidImage(32, 32, WHITE), 32, 32));
  assert.equal(plan.textColor, PALETTE.ink);
  assert.equal(plan.opacity, 0);
  assert.ok(plan.readableWithoutScrim);
  assert.equal(plan.unevenBackground, false);
  assert.equal(plan.fallbackToSurface, false);
});

test("真っ黒な背景は薄い文字・覆いなし（暗い配色を1枚足さずに済む側を選ばない）", () => {
  const plan = planScrim(measureBackground(solidImage(32, 32, BLACK), 32, 32));
  // 覆い 0 で 20:1 出るので、写真を一切隠さないこちらを採る
  assert.equal(plan.textColor, PALETTE.surface);
  assert.equal(plan.opacity, 0);
  assert.ok(plan.readableWithoutScrim);
  assert.equal(plan.unevenBackground, false);
});

test("中間の灰色は覆いが必要。薄くて済むほうの文字色を選ぶ", () => {
  const plan = planScrim(measureBackground(solidImage(32, 32, MID), 32, 32));
  assert.ok(plan.opacity > 0);
  assert.ok(plan.opacity <= MAX_SCRIM_OPACITY);
  assert.equal(plan.readableWithoutScrim, false);
  assert.equal(plan.fallbackToSurface, false);
  // 覆いと文字は必ず明暗が逆の組み合わせになる
  assert.notEqual(plan.textColor, plan.scrimColor);
});

test("明暗が激しい画像は「そのままでは読めない」と判定される", () => {
  const plan = planScrim(measureBackground(halfImage(48, 48, BLACK, WHITE), 48, 48));
  assert.ok(plan.unevenBackground, "どちらの文字色でも覆いなしでは読めない");
  assert.equal(plan.readableWithoutScrim, false);
  assert.ok(plan.opacity > 0.4, `覆いが薄すぎる: ${plan.opacity}`);

  // 平均輝度が同じ平坦なグレーとは判定が違う（平均だけ見ていたら区別できない）
  const flat = planScrim(measureBackground(solidImage(48, 48, { r: 188, g: 188, b: 188 }), 48, 48));
  assert.equal(flat.unevenBackground, false);
  assert.ok(flat.opacity < plan.opacity);
});

test("覆いの上限を超えるなら写真をあきらめて通常のカードに戻す", () => {
  const stats = measureBackground(halfImage(48, 48, BLACK, WHITE), 48, 48);
  // 上限を 0.2 に絞ると、半分白・半分黒はどうやっても満たせない
  const plan = planScrim(stats, { maxOpacity: 0.2 });
  assert.ok(plan.fallbackToSurface);
  assert.equal(plan.opacity, 1);
  assert.equal(plan.scrimColor, PALETTE.surface);
  assert.equal(plan.textColor, PALETTE.ink);
  assert.ok(plan.worstContrast > 15, "通常のカードなので余裕で満たす");
  assert.ok(plan.unevenBackground);
});

test("画像が測れなかった（null）ときも安全側に倒れる", () => {
  const plan = planScrim(null);
  assert.ok(plan.fallbackToSurface);
  assert.equal(plan.opacity, 1);
  assert.ok(plan.worstContrast > 15);
  assert.equal(plan.readableWithoutScrim, false);
});

test("補助文の色（--ink-3）を乗せるなら、そのぶん覆いが濃くなる", () => {
  const stats = measureBackground(solidImage(32, 32, MID), 32, 32);
  const body = planScrim(stats, { darkText: COLOR.ink });
  const sub = planScrim(stats, { darkText: COLOR.ink3 });
  // どちらも目標は満たすが、薄い文字のほうが覆いを濃くしないと届かない
  assert.ok(sub.worstContrast >= TARGET_BODY);
  if (sub.textColor === PALETTE.ink3) assert.ok(sub.opacity >= body.opacity);
});

test("返す値はそのまま CSS に書ける形になっている", () => {
  const plan = planScrim(measureBackground(solidImage(32, 32, MID), 32, 32));
  assert.match(plan.textColor, /^#[0-9a-f]{6}$/);
  assert.match(plan.scrimBackground, /^rgba\(\d+, \d+, \d+, 0?\.\d+\)$/);
  assert.equal(plan.cssVars["--scrim"], plan.scrimBackground);
  assert.equal(plan.cssVars["--scrim-ink"], plan.textColor);
  // 不透明度は 0.01 刻み。小数の尾を引かない
  assert.equal(plan.opacity, Number(plan.opacity.toFixed(2)));
  // 不透明なら色だけ返す（rgba(..., 1) のような冗長な書き方にしない）
  assert.equal(toCssColor(COLOR.surface, 1), PALETTE.surface);
  assert.equal(toCssColor(COLOR.ink, 0.5), "rgba(25, 34, 42, 0.5)");
});

test("壊れた値を渡しても例外にせず範囲内に収める", () => {
  assert.equal(toCssColor({ r: 999, g: -5, b: Number.NaN }), "#ff0000");
  assert.equal(relativeLuminance({ r: Number.NaN, g: Number.NaN, b: Number.NaN }), 0);
  assert.deepEqual(grayForLuminance(-1), BLACK);
  assert.deepEqual(grayForLuminance(99), WHITE);
  assert.deepEqual(compositeOver(WHITE, Number.NaN, BLACK), BLACK);
  assert.deepEqual(compositeOver(WHITE, 5, BLACK), WHITE);
});
