/*
  画面の縁の花飾り。

  設計の前提（docs/PLAN.md §4.6「色・動き・音」と §4.8）:

  ・**動かさない。** 揺れ・回転・フェードイン・開花、どれも入れない。
    `prefers-reduced-motion` で止めるのではなく、はじめから何も動かさない。
    毎回開くたびに動くものを置かない、という §4.6 の方針そのまま。
  ・**彩度を落とす。** 原色は使わない。既存の識別色 --item-1〜6 と --accent を
    そのまま置くと装飾のほうが本文より目立つので、同じ色相で彩度と輝度を
    落とした「親戚の色」だけを使う（下の PALETTES のコメント参照）。
  ・**文字の可読性を下げない。** 縁の 22〜26px の帯の中だけに描く。
    さらに z-index を本文より下に置くので、スクロールで文字が帯を通っても
    文字は必ず花より手前に出る（花の色は薄いので重なってもコントラストは保つ）。
  ・**外部画像を読まない。** 通信ゼロの方針。インラインSVGだけで描く。
  ・**支援技術には出さない。** 飾りなので aria-hidden。
  ・**タップを邪魔しない。** pointer-events: none。

  画面の大きさへの追従:
    390×844 の設計座標で描き、4辺ごとの入れ子 <svg> の preserveAspectRatio で
    上下左右に張り付けている。JS で画面を測らないので、初回描画から位置が決まり、
    あとからズレない。縦に長い端末では横帯が幅に、縦帯が高さに合わせて伸びる
    （meet なので長辺が制約になる）。
*/

export type FlowerDensity = "none" | "sparse" | "normal" | "lush";
export type FlowerPalette = "soft" | "warm" | "cool";

type Props = {
  /** 花の数。既定は normal。none は何も描かない。 */
  density?: FlowerDensity;
  /** 花の色の組み合わせ。既定は soft。 */
  palette?: FlowerPalette;
};

/* ---- 色 -------------------------------------------------------------

   どれも globals.css の識別色と同じ色相で、彩度を 1/3 前後まで落として
   明度を上げたもの。背景 --bg (#f2f4f5) の上で「色みはわかるが主張しない」
   明るさに揃えてある。純色・蛍光色は入れない。

   soft … --item-6(紅) / --item-5(紫) / --item-3(青緑) / --item-4(金) の薄い親戚
   warm … --item-2(赤茶) / --item-4(金) / --item-6(紅) 寄り
   cool … --item-1(青) / --item-3(青緑) / --item-5(紫) 寄り。--accent と同系
   葉と蔓はどの組み合わせでも --item-3 系の灰みの緑で、花の色を邪魔しない。
*/
type Pal = { petals: string[]; core: string; leaf: string; vine: string };

const PALETTES: Record<FlowerPalette, Pal> = {
  soft: {
    petals: ["#c9a7b3", "#b0a6c4", "#a2b9af", "#c8bda2"],
    core: "#d9cdb2",
    leaf: "#a3b7a9",
    vine: "#b4c0b6",
  },
  warm: {
    petals: ["#c8a596", "#cbb792", "#c3a0a3", "#bdac8f"],
    core: "#dccfae",
    leaf: "#aab59c",
    vine: "#bcc0ad",
  },
  cool: {
    petals: ["#a2b2c6", "#9cbab2", "#aeadc8", "#b6c2c6"],
    core: "#cfd6cf",
    leaf: "#9fb4ad",
    vine: "#b0bdbc",
  },
};

/* ---- 数 -------------------------------------------------------------

   帯の幅は本文の外側に収める。390px の iPhone では .wrap の左右の余白が
   20px なので、左右の帯は 24 設計単位（花の中心は縁から 11）。
   葉の先が数px カードに乗ることはあるが、本文は z-index で手前にある。
*/
const W = 390; // 設計上の画面幅
const H = 844; // 設計上の画面高さ
const SIDE = 24; // 左右の帯の幅
const TOP = 22; // 上の帯の高さ（見出しの文字より上に収める）
const BOT = 26; // 下の帯の高さ（.wrap の下余白は 40px なので少し広く取れる）

/** 花の数。左右の辺／上下の辺で別に持つ。 */
const COUNTS: Record<Exclude<FlowerDensity, "none">, { side: number; edge: number }> = {
  sparse: { side: 7, edge: 4 },
  normal: { side: 13, edge: 7 },
  lush: { side: 21, edge: 12 },
};

/* 出てくる形の割合。丸い花を多めにして、細い花・蕾・葉・小さな実を混ぜる。
   凝りすぎると縁が騒がしくなるので6種類で止める。 */
const KINDS = [
  "round",
  "slim",
  "round",
  "bell",
  "leaf",
  "bud",
  "slim",
  "leaf",
  "dots",
  "round",
  "bell",
  "leaf",
] as const;

type Kind = (typeof KINDS)[number];

/* 乱数は使うが、固定の種から出す。Math.random() だとサーバーとブラウザで
   違う形が出て hydration が合わなくなるし、開くたびに絵が変わる
   （§4.6「開いたとき毎回同じ画面」に反する）。 */
function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const n = (v: number) => Math.round(v * 100) / 100;

/** 1つの花（または葉）。t は辺に沿った位置、u は画面の縁からの距離。 */
type Sprig = { k: Kind; t: number; u: number; s: number; c: string; o: number };

function sprigs(count: number, seed: number, len: number, pad: number, uc: number, pal: Pal): Sprig[] {
  const r = rng(seed);
  const out: Sprig[] = [];
  const step = (len - pad * 2) / count;
  for (let i = 0; i < count; i++) {
    const k = KINDS[Math.floor(r() * KINDS.length)];
    const small = k === "leaf" || k === "dots" || k === "bud";
    const s = small ? 10 + r() * 5 : 13 + r() * 6;
    out.push({
      k,
      // 等間隔から少しずらす。並びが規則的すぎると機械的に見える。
      t: pad + step * (i + 0.5) + (r() - 0.5) * step * 0.55,
      // 画面の外にはみ出すと花が半分に切れて見えるので、
      // 縁からの距離は「半径 + 0.8」より内側に必ず入れる。
      u: Math.max(uc + (r() - 0.5) * 3.4, s / 2 + 0.8),
      s,
      c: k === "leaf" ? pal.leaf : pal.petals[Math.floor(r() * pal.petals.length)],
      o: 0.7 + r() * 0.3,
    });
  }
  return out;
}

/** 蔓。縁に沿う緩い波。二次ベジエを交互に振るだけ。 */
function vine(len: number, base: number, amp: number, period: number, horiz: boolean): string {
  const P = (a: number, b: number) => (horiz ? `${n(a)} ${n(b)}` : `${n(b)} ${n(a)}`);
  let d = `M${P(-10, base)}`;
  let dir = 1;
  for (let a = -10; a < len + 10; a += period) {
    d += `Q${P(a + period / 2, base + amp * dir)} ${P(a + period, base)}`;
    dir = -dir;
  }
  return d;
}

/* ---- 花の形 ----------------------------------------------------------
   1種類を <symbol> で1回だけ定義して、配置は <use> で済ませる。
   花びらは currentColor にしてあるので、<use> 側の color だけで色が変わる。
   20×20 の中に描き、<use> の width/height で大きさを変える。
*/
function petals(count: number, cy: number, rx: number, ry: number) {
  return Array.from({ length: count }, (_, i) => (
    <ellipse
      key={i}
      cx="10"
      cy={cy}
      rx={rx}
      ry={ry}
      transform={`rotate(${n((360 / count) * i)} 10 10)`}
    />
  ));
}

function Defs({ pal }: { pal: Pal }) {
  return (
    <defs>
      {/* 丸い花。花びら6枚 */}
      <symbol id="mb-round" viewBox="0 0 20 20">
        <g fill="currentColor">{petals(6, 5.6, 3.1, 3.5)}</g>
        <circle cx="10" cy="10" r="2.4" fill={pal.core} />
      </symbol>

      {/* 細い花びらの花。8枚 */}
      <symbol id="mb-slim" viewBox="0 0 20 20">
        <g fill="currentColor">{petals(8, 5.4, 1.15, 4.4)}</g>
        <circle cx="10" cy="10" r="1.9" fill={pal.core} />
      </symbol>

      {/* 釣鐘のような花。5枚 */}
      <symbol id="mb-bell" viewBox="0 0 20 20">
        <g fill="currentColor">{petals(5, 6, 2.5, 3.9)}</g>
        <circle cx="10" cy="10" r="1.7" fill={pal.core} />
      </symbol>

      {/* 小さな蕾。短い茎つき */}
      <symbol id="mb-bud" viewBox="0 0 20 20">
        <path d="M10 16v-4" stroke={pal.vine} strokeWidth="1.1" fill="none" strokeLinecap="round" />
        <path d="M10 3c3.1 2.9 3.1 7.5 0 10.4C6.9 10.5 6.9 5.9 10 3z" fill="currentColor" />
      </symbol>

      {/* 葉。中脈を1本だけ入れる */}
      <symbol id="mb-leaf" viewBox="0 0 20 20">
        <path d="M3 17C5 10.5 9.5 5.5 17 3c-1.5 7.5-6.5 12.5-14 14z" fill="currentColor" />
        <path d="M4.5 15.5C8 12 11.5 8.5 15.5 4.6" stroke={pal.vine} strokeWidth="0.9" fill="none" />
      </symbol>

      {/* 小さな実。3粒 */}
      <symbol id="mb-dots" viewBox="0 0 20 20">
        <g fill="currentColor">
          <circle cx="7.2" cy="7.6" r="2.3" />
          <circle cx="13" cy="9.6" r="1.9" />
          <circle cx="8.8" cy="13.2" r="2" />
        </g>
      </symbol>
    </defs>
  );
}

/* ---- 1辺 ------------------------------------------------------------
   辺ごとに入れ子の <svg> を1つ置く。4つとも親いっぱいに広げ、
   viewBox と preserveAspectRatio だけを変えて上下左右に寄せている。
   こうすると「下から 26px」のような位置を calc も JS も使わずに書ける。
*/
type Edge = "top" | "bottom" | "left" | "right";

const GEOM: Record<Edge, { box: string; par: string; len: number; band: number; horiz: boolean }> = {
  top: { box: `0 0 ${W} ${TOP}`, par: "xMinYMin meet", len: W, band: TOP, horiz: true },
  bottom: { box: `0 0 ${W} ${BOT}`, par: "xMinYMax meet", len: W, band: BOT, horiz: true },
  left: { box: `0 0 ${SIDE} ${H}`, par: "xMinYMin meet", len: H, band: SIDE, horiz: false },
  right: { box: `0 0 ${SIDE} ${H}`, par: "xMaxYMin meet", len: H, band: SIDE, horiz: false },
};

function Band({ edge, items, pal }: { edge: Edge; items: Sprig[]; pal: Pal }) {
  const g = GEOM[edge];
  // u（縁からの距離）を、その辺の座標に直す
  const flip = edge === "bottom" || edge === "right";
  const toU = (u: number) => (flip ? g.band - u : u);
  const xy = (t: number, u: number) => (g.horiz ? { x: t, y: toU(u) } : { x: toU(u), y: t });

  const vineBase = toU(4.6);
  const vineAmp = (flip ? -1 : 1) * 2.8;

  return (
    <svg
      x="0"
      y="0"
      width="100%"
      height="100%"
      viewBox={g.box}
      preserveAspectRatio={g.par}
    >
      <path
        d={vine(g.len, vineBase, vineAmp, g.horiz ? 62 : 78, g.horiz)}
        fill="none"
        stroke={pal.vine}
        strokeWidth="1.3"
        strokeLinecap="round"
        opacity="0.75"
      />
      {items.map((it, i) => {
        const p = xy(it.t, it.u);
        return (
          <use
            key={i}
            href={`#mb-${it.k}`}
            x={n(p.x - it.s / 2)}
            y={n(p.y - it.s / 2)}
            width={n(it.s)}
            height={n(it.s)}
            style={{ color: it.c, opacity: n(it.o) }}
          />
        );
      })}
    </svg>
  );
}

export default function FlowerFrame({ density = "normal", palette = "soft" }: Props) {
  if (density === "none") return null;

  const pal = PALETTES[palette];
  const c = COUNTS[density];

  // 辺ごとに種を変える。角で同じ並びが鏡像に見えないように。
  const items: Record<Edge, Sprig[]> = {
    // 上下は角を左右の帯にゆずるため、両端 26 をあけて並べる
    top: sprigs(c.edge, 11, W, 26, TOP / 2 - 1, pal),
    bottom: sprigs(c.edge, 23, W, 26, BOT / 2, pal),
    left: sprigs(c.side, 37, H, 6, 11, pal),
    right: sprigs(c.side, 53, H, 6, 11, pal),
  };

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      style={{
        position: "fixed",
        // ノッチとホームバーに食い込ませない
        top: "env(safe-area-inset-top, 0px)",
        left: "env(safe-area-inset-left, 0px)",
        // 100vw / 100vh を使わないのは、スクロールバーの幅ぶん横に
        // はみ出して横スクロールが出ることがあるため。
        width: "calc(100% - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px))",
        height: "calc(100% - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))",
        // タップを一切奪わない
        pointerEvents: "none",
        // 本文より後ろ。スクロールで文字が帯を通っても文字が手前に出る。
        zIndex: -1,
      }}
    >
      <Defs pal={pal} />
      <Band edge="top" items={items.top} pal={pal} />
      <Band edge="bottom" items={items.bottom} pal={pal} />
      <Band edge="left" items={items.left} pal={pal} />
      <Band edge="right" items={items.right} pal={pal} />
    </svg>
  );
}
