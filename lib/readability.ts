/*
  背景画像の上でも文字が読めることを保証する計算。docs/PLAN.md §4.6

  問題: 利用者が任意の写真を背景にすると、明るい写真に濃い文字・暗い写真に
  薄い文字が乗って読めなくなる。これは好みの話ではなく WCAG 1.4.3
  （本文 4.5:1 / 大きな文字 3:1）を満たせないという欠陥。

  方針（ここが全部の前提）:

  1. 写真を加工しない。写真と文字のあいだに「スクリム（覆い）」を1枚入れて、
     その不透明度だけを計算で決める。写真そのものを触らないので、
     元画像を保ったまま、どの端末でも同じ結果になる。

  2. 平均の明るさでは決めない。WCAG は「平均して読める」ではなく
     「文字が乗っている場所すべてで読める」を要求している。
     だから代表値として暗い側・中央・明るい側の3点（既定で下2% / 50% / 上98%）を
     取り、その全部で目標を満たす不透明度を採用する。
     平均が中間のグレーでも、半分白・半分黒の写真は両端で落ちる。
     保証できないのは外側 2% ずつ。理由は EDGE_PERCENTILE のコメントに書いた。

  3. 代表値は「実在するピクセルの色」をそのまま使う。輝度だけを取り出して
     グレーに戻すと、彩度の高い写真で合成後の輝度を読み違える
     （純青 #0000ff は輝度 0.07 だが、白を50%かぶせても青チャンネルは
     255 のままなので、同じ輝度のグレーより暗く仕上がる）。

  4. 合成は sRGB のエンコード済み値（0-255）のまま線形補間する。
     CSS の alpha 合成がそうしているため。輝度の計算だけ線形化する。

  5. スクリムと文字色は、このアプリのトークン2色の入れ替えだけにする。
     明るい側 --surface #fdfdfc / 暗い側 --ink #19222a。
     純白 #fff と純黒 #000 は使わない（§4.6、感覚負荷を避けるため）。
     ダークモードを作らない方針なので、迷ったら「濃い文字＋明るい覆い」を
     優先する。暗い板が明るいUIの中に1枚だけ現れるのを避けたい。

  6. 覆いの上限は 0.8。トレードオフ: 覆いを濃くすれば必ず読めるが、
     濃くするほど背景を入れた意味がなくなる。0.8 を超える必要がある写真は
     「文字の下に敷くには向かない写真」なので、半端に濃い膜でごまかさず、
     その領域だけ通常のカード（--surface 不透明）に戻す。
     どちらを選んだかは fallbackToSurface で呼び出し側に伝える。

  7. 目標には +0.02 の余裕を足す。画面は8bitで、ブラウザの合成精度も
     端末依存なので、ちょうど 4.500 を狙うと実機で 4.49 になりうる。
     「計算上は通っているのに読めない」を避けるための保険。
*/

export type Rgb = { readonly r: number; readonly g: number; readonly b: number };

/** app/globals.css のトークン。ここと CSS の2箇所に同じ値があるので、片方を変えたら両方変える。 */
export const PALETTE = {
  ink: "#19222a",
  ink2: "#40505a",
  ink3: "#5a6872",
  surface: "#fdfdfc",
  bg: "#f2f4f5",
} as const;

/** WCAG 1.4.3 の下限。本文 4.5:1、18.66px以上の太字または24px以上なら 3:1。 */
export const TARGET_BODY = 4.5;
export const TARGET_LARGE = 3;

/** 8bit の丸めとブラウザの合成精度を吸収するための上乗せ（方針7）。 */
export const SAFETY_MARGIN = 0.02;

/** 覆いの上限（方針6）。これを超えるなら写真をあきらめる。 */
export const MAX_SCRIM_OPACITY = 0.8;

/** CSS に書く不透明度の刻み。0.01 より細かくしても画面上の差はない。 */
export const OPACITY_STEP = 0.01;

/** 間引きの既定値。端の分位点が安定する程度の数で、iPhone でも1ms未満で終わる。 */
export const DEFAULT_MAX_SAMPLES = 2000;

/*
  代表ピクセルを取る位置。下から2% / 上から2%。

  min/max（0% と 100%）にしないのは、JPEG のノイズ1点や小さな鏡面反射の
  白飛び1点で、ほかは問題ない写真に真っ白な膜をかけることになるため。
  逆に 5% まで捨てると、文字領域の 5% は十分に目で見える面積なので捨てすぎる。
  2% は「1点のゴミは無視する／見える面積は無視しない」の折り合い。
*/
export const EDGE_PERCENTILE = 0.02;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** 色の指定はコードから来る（利用者入力ではない）ので、読めなければ例外にする。 */
export function parseHexColor(hex: string): Rgb {
  const match = HEX.exec(hex.trim());
  if (!match) throw new Error(`色は #rgb か #rrggbb で渡してください: ${hex}`);
  const body = match[1];
  const full =
    body.length === 3
      ? body[0] + body[0] + body[1] + body[1] + body[2] + body[2]
      : body;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function toHexColor(c: Rgb): string {
  const hex = (v: number) => clampByte(v).toString(16).padStart(2, "0");
  return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
}

/** CSS の色。rgba() の旧構文を使う。iPhone の古い Safari でも必ず通り、失うものがない。 */
export function toCssColor(c: Rgb, alpha = 1): string {
  const a = clamp01(alpha);
  if (a >= 1) return toHexColor(c);
  return `rgba(${clampByte(c.r)}, ${clampByte(c.g)}, ${clampByte(c.b)}, ${a})`;
}

export const COLOR = {
  ink: parseHexColor(PALETTE.ink),
  ink2: parseHexColor(PALETTE.ink2),
  ink3: parseHexColor(PALETTE.ink3),
  surface: parseHexColor(PALETTE.surface),
  bg: parseHexColor(PALETTE.bg),
} as const;

function clampByte(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(255, Math.max(0, Math.round(v)));
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/*
  相対輝度。WCAG 2.x の定義そのまま。
  sRGB の 0-255 はガンマがかかった値なので、重みを付ける前に線形に戻す。
  純関数。
*/
function channelToLinear(v255: number): number {
  const v = clampByte(v255) / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(c: Rgb): number {
  return (
    0.2126 * channelToLinear(c.r) +
    0.7152 * channelToLinear(c.g) +
    0.0722 * channelToLinear(c.b)
  );
}

/** コントラスト比。WCAG 2.x。純関数。黒と白で 21、同じ色どうしで 1。 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/*
  輝度から等価なグレーを作る。「明るさの数値しか持っていない」呼び出し側のため。
  方針3のとおり、彩度のある写真ではこの近似は合成後の輝度を外すので、
  実在ピクセル（measureBackground の darkEdge など）があるならそちらを使う。
*/
export function grayForLuminance(luminance: number): Rgb {
  const l = clamp01(luminance);
  const v = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  const byte = clampByte(v * 255);
  return { r: byte, g: byte, b: byte };
}

/*
  top を alpha で bottom の上にのせた結果。
  CSS の alpha 合成はエンコード済みの sRGB 値で線形に混ざるので、ここも同じにする。
  画面は8bitなので整数に丸める（実機で見える値に合わせる）。
*/
export function compositeOver(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  const a = clamp01(alpha);
  return {
    r: clampByte(a * clampByte(top.r) + (1 - a) * clampByte(bottom.r)),
    g: clampByte(a * clampByte(top.g) + (1 - a) * clampByte(bottom.g)),
    b: clampByte(a * clampByte(top.b) + (1 - a) * clampByte(bottom.b)),
  };
}

/* ---- 画像の明るさを測る ------------------------------------------------ */

/** 文字が乗る領域（画像のピクセル座標）。省略時は画像全体。 */
export type Region = { x: number; y: number; width: number; height: number };

export type BackgroundStats = {
  /** 実際に見たピクセル数（間引き後） */
  sampleCount: number;
  /** 何ピクセルおきに見たか */
  step: number;
  meanLuminance: number;
  /** 輝度の標準偏差。平坦さの目安（診断用） */
  stdDevLuminance: number;
  minLuminance: number;
  maxLuminance: number;
  /** チャンネルごとの平均色。プレビューなどの参考用 */
  meanColor: Rgb;
  /** 代表ピクセル。暗い側 / 中央 / 明るい側。合成の判定はこの3点で行う */
  darkEdge: Rgb;
  median: Rgb;
  brightEdge: Rgb;
  /** 背景じたいの明暗差（darkEdge と brightEdge のコントラスト比）。1 に近いほど平坦 */
  edgeContrast: number;
};

/*
  canvas から取った RGBA（Uint8ClampedArray）を測る。

  ・全画素は舐めない。領域の面積から step = round(sqrt(面積 / 標本数)) を出し、
    格子状に間引く。ランダムではなく格子にするのは、同じ画像で必ず同じ結果に
    なるようにするため（テストできる・再計算で値が揺れない）。
  ・透過ピクセルは、アプリの地色 --bg の上に合成した色として扱う。
    alpha を無視すると、完全透過（0,0,0,0）を真っ黒と読んで
    「白文字にすべき」と逆の判断をしてしまう。
  ・使えない入力では例外ではなく null を返す（money.ts の parseAmount と同じ構え）。
    呼び出し側は planScrim(null) に渡せば安全側（通常のカード）に倒れる。

  実測: 1179x2556（iPhone の3倍解像度）の一部 440k 画素で 1.7ms（開発機）。
  背景を変えたときと向きが変わったときだけ呼ぶ想定で、毎フレームは呼ばない。
*/
export function measureBackground(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: {
    region?: Region;
    maxSamples?: number;
    under?: Rgb;
    edgePercentile?: number;
  } = {},
): BackgroundStats | null {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width <= 0 || height <= 0) return null;
  if (pixels.length < width * height * 4) return null;

  const region = clampRegion(opts.region ?? { x: 0, y: 0, width, height }, width, height);
  if (!region) return null;

  const maxSamples = Math.max(1, Math.floor(opts.maxSamples ?? DEFAULT_MAX_SAMPLES));
  const under = opts.under ?? COLOR.bg;
  const area = region.width * region.height;
  const step = Math.max(1, Math.round(Math.sqrt(area / maxSamples)));

  const samples: { color: Rgb; luminance: number }[] = [];
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumL = 0;

  for (let y = region.y; y < region.y + region.height; y += step) {
    for (let x = region.x; x < region.x + region.width; x += step) {
      const i = (y * width + x) * 4;
      const alpha = pixels[i + 3] / 255;
      const raw = { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2] };
      const color = alpha >= 1 ? raw : compositeOver(raw, alpha, under);
      const luminance = relativeLuminance(color);
      samples.push({ color, luminance });
      sumR += color.r;
      sumG += color.g;
      sumB += color.b;
      sumL += luminance;
    }
  }

  const n = samples.length;
  if (n === 0) return null;

  samples.sort((a, b) => a.luminance - b.luminance);
  const at = (p: number) => samples[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))];

  const mean = sumL / n;
  /*
    分散は2パス目で平均からの差を足す。E[X²]-E[X]² の1パス式は
    平坦な画像（差が本当に0）で 1e-7 のような嘘のばらつきを出すので使わない。
    標本は 2000 程度なので2周しても誤差に見合うコストではない。
  */
  let sumSq = 0;
  for (const s of samples) sumSq += (s.luminance - mean) ** 2;
  const variance = Math.max(0, sumSq / n);
  const edge = Math.min(0.5, Math.max(0, opts.edgePercentile ?? EDGE_PERCENTILE));
  const darkEdge = at(edge).color;
  const brightEdge = at(1 - edge).color;

  return {
    sampleCount: n,
    step,
    meanLuminance: mean,
    stdDevLuminance: Math.sqrt(variance),
    minLuminance: samples[0].luminance,
    maxLuminance: samples[n - 1].luminance,
    meanColor: { r: clampByte(sumR / n), g: clampByte(sumG / n), b: clampByte(sumB / n) },
    darkEdge,
    median: at(0.5).color,
    brightEdge,
    edgeContrast: contrastRatio(darkEdge, brightEdge),
  };
}

function clampRegion(region: Region, width: number, height: number): Region | null {
  const x = Math.max(0, Math.floor(region.x));
  const y = Math.max(0, Math.floor(region.y));
  if (!Number.isFinite(region.width) || !Number.isFinite(region.height)) return null;
  const w = Math.min(width - x, Math.floor(region.width));
  const h = Math.min(height - y, Math.floor(region.height));
  if (w <= 0 || h <= 0) return null;
  return { x, y, width: w, height: h };
}

/* ---- スクリムの不透明度を決める ---------------------------------------- */

export type ScrimSolve = {
  /** 0..1、OPACITY_STEP 刻み。これをそのまま CSS に書ける */
  opacity: number;
  /** その不透明度で合成したあとの、文字色とのコントラスト比 */
  contrast: number;
  /** 目標（+SAFETY_MARGIN）に届いたか。false なら上限まで濃くしても足りない */
  meetsTarget: boolean;
  /** 使った覆いの色 */
  scrimColor: Rgb;
};

/*
  背景色1点と文字色を渡すと、目標コントラストを満たす「最小の」不透明度を返す。

  覆いの色は省略すると文字色から決める。濃い文字なら明るい覆い、
  薄い文字なら暗い覆い。逆の組み合わせ（濃い文字に暗い覆い）は、
  覆いを濃くするほどいったん読めなくなるので選ばない。

  刻みの上を下から順に試して最初に通った値を返す。二分探索にしないのは、
  コントラストが不透明度に対して必ず単調とは限らない（文字色が中間の明度で、
  覆いが文字色をまたぐ場合）ため。この走査なら単調性を仮定しないで最小値が出る。
  また、返す値は「丸めたあとの不透明度で実際に計算して通った値」なので、
  丸めで目標を割ることがない。
*/
export function minScrimOpacity(
  background: Rgb,
  textColor: Rgb,
  opts: {
    scrimColor?: Rgb;
    targetRatio?: number;
    maxOpacity?: number;
    step?: number;
  } = {},
): ScrimSolve {
  const target = (opts.targetRatio ?? TARGET_BODY) + SAFETY_MARGIN;
  const maxOpacity = clamp01(opts.maxOpacity ?? MAX_SCRIM_OPACITY);
  const step = Math.min(1, Math.max(0.001, opts.step ?? OPACITY_STEP));
  const scrimColor =
    opts.scrimColor ?? (relativeLuminance(textColor) < 0.5 ? COLOR.surface : COLOR.ink);

  let best: ScrimSolve = {
    opacity: 0,
    contrast: contrastRatio(textColor, background),
    meetsTarget: false,
    scrimColor,
  };
  if (best.contrast >= target) return { ...best, meetsTarget: true };

  // 0.8 / 0.01 は浮動小数点で 79.999... になるので round で拾う。
  // 刻みが上限を跨がないよう、値そのものは maxOpacity で止める。
  const steps = Math.round(maxOpacity / step);
  for (let k = 1; k <= steps; k++) {
    const opacity = Math.min(maxOpacity, Number((k * step).toFixed(4)));
    const contrast = contrastRatio(textColor, compositeOver(scrimColor, opacity, background));
    if (contrast >= target) return { opacity, contrast, meetsTarget: true, scrimColor };
    if (contrast > best.contrast) best = { opacity, contrast, meetsTarget: false, scrimColor };
  }
  return best;
}

export type ScrimPlan = {
  /** 文字色（CSS, #rrggbb） */
  textColor: string;
  /** 覆いの色（CSS, #rrggbb） */
  scrimColor: string;
  /** 覆いの不透明度 0..1 */
  opacity: number;
  /** 覆いの要素の background にそのまま入れる値 */
  scrimBackground: string;
  /** 代表3点のうち最も悪いところで達成したコントラスト比 */
  worstContrast: number;
  /** 覆いなしで足りている（opacity === 0） */
  readableWithoutScrim: boolean;
  /** 明暗差が大きく、どちらの文字色でも覆いなしでは読めない写真 */
  unevenBackground: boolean;
  /** 上限を超えたので背景写真をあきらめ、通常のカード（不透明）に戻した */
  fallbackToSurface: boolean;
  /** そのまま style に流せる CSS カスタムプロパティ */
  cssVars: { "--scrim": string; "--scrim-ink": string };
};

/*
  測った背景から、文字色と覆いの不透明度を決める。

  ・候補は2つだけ。「--ink の文字 + --surface の覆い」と
    「--surface の文字 + --ink の覆い」。
  ・代表3点（p05 / p50 / p95）の全部で目標を満たす不透明度を候補ごとに出し、
    薄くて済むほうを選ぶ。同点なら濃い文字（明るい覆い）を選ぶ。
    §4.6 で暗い配色を作らない方針なので、明るいUIの中に暗い板を
    置かないほうを既定にする。
  ・どちらも上限内で満たせないときは --surface を不透明で敷く。
    中途半端に濃い膜より、読めることを優先する。
  ・stats が null（画像が読めなかった）のときも同じ安全側に倒れる。

  大きな文字だけを置く領域なら targetRatio に TARGET_LARGE を渡す。覆いが薄くなる。
*/
export function planScrim(
  stats: BackgroundStats | null,
  opts: {
    targetRatio?: number;
    maxOpacity?: number;
    /** 濃い側の文字色。--ink-3 の補助文を乗せるならそれを渡す */
    darkText?: Rgb;
    /** 薄い側の文字色 */
    lightText?: Rgb;
    step?: number;
  } = {},
): ScrimPlan {
  const targetRatio = opts.targetRatio ?? TARGET_BODY;
  const darkText = opts.darkText ?? COLOR.ink;
  const lightText = opts.lightText ?? COLOR.surface;

  if (!stats) return fallbackPlan(darkText, false);

  const probes = [stats.darkEdge, stats.median, stats.brightEdge];
  const solve = (textColor: Rgb, scrimColor: Rgb) => {
    let opacity = 0;
    let meetsTarget = true;
    for (const probe of probes) {
      const r = minScrimOpacity(probe, textColor, {
        scrimColor,
        targetRatio,
        maxOpacity: opts.maxOpacity,
        step: opts.step,
      });
      if (!r.meetsTarget) meetsTarget = false;
      opacity = Math.max(opacity, r.opacity);
    }
    // 採用する不透明度は全代表点で共通なので、最悪値をそこで測り直す
    let worstContrast = Number.POSITIVE_INFINITY;
    for (const probe of probes) {
      worstContrast = Math.min(
        worstContrast,
        contrastRatio(textColor, compositeOver(scrimColor, opacity, probe)),
      );
    }
    return { textColor, scrimColor, opacity, meetsTarget, worstContrast };
  };

  const darkOnLight = solve(darkText, COLOR.surface);
  const lightOnDark = solve(lightText, COLOR.ink);

  // 覆いなしで足りる候補が1つもない = 明暗差が大きすぎる写真
  const unevenBackground =
    !(darkOnLight.meetsTarget && darkOnLight.opacity === 0) &&
    !(lightOnDark.meetsTarget && lightOnDark.opacity === 0);

  const usable = [darkOnLight, lightOnDark].filter((c) => c.meetsTarget);
  if (usable.length === 0) return fallbackPlan(darkText, unevenBackground);

  // 薄いほうを採る。同点は濃い文字（明るい覆い）優先なので、先に入れた順で安定。
  const chosen = usable.reduce((a, b) => (b.opacity < a.opacity ? b : a));

  return {
    textColor: toHexColor(chosen.textColor),
    scrimColor: toHexColor(chosen.scrimColor),
    opacity: chosen.opacity,
    scrimBackground: toCssColor(chosen.scrimColor, chosen.opacity),
    worstContrast: chosen.worstContrast,
    readableWithoutScrim: chosen.opacity === 0,
    unevenBackground,
    fallbackToSurface: false,
    cssVars: {
      "--scrim": toCssColor(chosen.scrimColor, chosen.opacity),
      "--scrim-ink": toHexColor(chosen.textColor),
    },
  };
}

/* 写真をあきらめる。通常のカードと同じ --surface + 濃い文字で 15:1 以上出る。 */
function fallbackPlan(darkText: Rgb, unevenBackground: boolean): ScrimPlan {
  return {
    textColor: toHexColor(darkText),
    scrimColor: PALETTE.surface,
    opacity: 1,
    scrimBackground: PALETTE.surface,
    worstContrast: contrastRatio(darkText, COLOR.surface),
    readableWithoutScrim: false,
    unevenBackground,
    fallbackToSurface: true,
    cssVars: { "--scrim": PALETTE.surface, "--scrim-ink": toHexColor(darkText) },
  };
}
