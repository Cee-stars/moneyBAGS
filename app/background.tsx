"use client";

/*
  背景のレイヤー。docs/PLAN.md §4.9

  画面の一番うしろに3枚だけ重ねる。上に行くほど手前:

    1. .bg-photo  利用者が選んだ写真（なければ出さない）
    2. .bg-scrim  文字が読めるようにする覆い。濃さは取り込み時に計算して保存した値
    3. .bg-decor  花の枠（app/flower-frame.tsx をそのまま使う）
    （本文は .wrap 側に z-index: 1 を与えて、この3枚より手前に出す）

  やってはいけないことが3つあるので、触る前に読んでください（iOS の一次情報で確認済み）:

  ・**background-attachment: fixed を使わない。** iOS では「認識されるが効果がない」と
    MDN の互換データに明記されている（WebKit bug 275247）。だから
    position: fixed; inset: 0 の専用レイヤーにしている。
  ・**負の z-index を使わない。** 背景に負の z-index を付けると上下に余白が出る
    報告がある。3枚とも z-index: 0 で、DOM の順番で前後を決めている。
    （flower-frame.tsx の中は z-index: -1 だが、.bg-decor が position + z-index で
    独自の重なり文脈を作るので、その -1 は .bg-decor の中だけの話に閉じる。
    結果として花は写真と覆いより手前、本文より後ろに来る。）
  ・**この3枚の祖先に transform / filter / will-change を付けない。** position: fixed の
    基準（containing block）を作ってしまい、背景が本文と一緒にスクロールする。

  動きは一切足さない（§4.6）。写真が差し替わるときもフェードしない。

  可読性については lib/readability.ts がすべてを決めている。ここは計算しない。
  取り込み時に1回だけ計算した結果（ScrimPlan）を保存してあり、ここはそれを
  CSS に流すだけ。毎回測り直さないのは、測ること自体が重いからではなく、
  **同じ写真で毎回同じ見た目になる**ほうが大事だから（§4.6「開いたとき毎回同じ画面」）。
*/

import { useCallback, useEffect, useRef, useState } from "react";
import FlowerFrame, { type FlowerDensity, type FlowerPalette } from "./flower-frame";
import { getImage, getSetting, IMAGE_ID, SETTING_KEY, setSetting } from "@/lib/db";
import { storedImageToBlob } from "@/lib/image";
import type { ScrimPlan } from "@/lib/readability";

/* ---- 設定の形 -------------------------------------------------------- */

export type FlowerSetting = {
  /** 既定はオン（本人の決定）。 */
  on: boolean;
  density: FlowerDensity;
  palette: FlowerPalette;
};

export const FLOWER_DEFAULT: FlowerSetting = {
  on: true,
  density: "normal",
  palette: "soft",
};

/*
  背景写真の設定。画像そのものは image ストアに別で入っている（lib/db.ts）。
  plan を一緒に持つのがこの機能の要。これがないと、画面を開くたびに
  写真をデコードして明るさを測り直すことになる。
*/
export type BackgroundSetting = {
  /** 取り込んだときに計算した覆いと文字色 */
  plan: ScrimPlan;
  width: number;
  height: number;
  bytes: number;
  /** ISO8601。いつの写真か設定画面に出す */
  importedAt: string;
};

const DENSITIES: FlowerDensity[] = ["none", "sparse", "normal", "lush"];
const PALETTES: FlowerPalette[] = ["soft", "warm", "cool"];

/** 保存から読んだものを確かめる。壊れていたら既定に戻す（画面が消えるより良い）。 */
export function parseFlowerSetting(raw: unknown): FlowerSetting {
  if (typeof raw !== "object" || raw === null) return FLOWER_DEFAULT;
  const r = raw as Partial<FlowerSetting>;
  return {
    on: typeof r.on === "boolean" ? r.on : FLOWER_DEFAULT.on,
    density:
      typeof r.density === "string" && (DENSITIES as string[]).includes(r.density)
        ? (r.density as FlowerDensity)
        : FLOWER_DEFAULT.density,
    palette:
      typeof r.palette === "string" && (PALETTES as string[]).includes(r.palette)
        ? (r.palette as FlowerPalette)
        : FLOWER_DEFAULT.palette,
  };
}

export function parseBackgroundSetting(raw: unknown): BackgroundSetting | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Partial<BackgroundSetting>;
  const plan = r.plan;
  if (typeof plan !== "object" || plan === null) return null;
  if (typeof plan.scrimBackground !== "string" || typeof plan.textColor !== "string") return null;
  if (typeof plan.opacity !== "number") return null;
  if (!Number.isFinite(r.width) || !Number.isFinite(r.height)) return null;
  return {
    plan: plan as ScrimPlan,
    width: Number(r.width),
    height: Number(r.height),
    bytes: Number(r.bytes ?? 0),
    importedAt: typeof r.importedAt === "string" ? r.importedAt : "",
  };
}

/* ---- 読み書き -------------------------------------------------------- */

export async function loadFlowerSetting(): Promise<FlowerSetting> {
  try {
    return parseFlowerSetting(await getSetting<unknown>(SETTING_KEY.flowerFrame, null));
  } catch {
    return FLOWER_DEFAULT;
  }
}

/*
  localStorage にも「オフかどうか」だけ写す。

  IndexedDB は非同期なので、オフにしているのに最初の1フレームだけ花が出る。
  app/layout.tsx の先頭スクリプトがこの値を読んで data-flower="off" を付け、
  globals.css が .bg-decor を display: none にする。text-size.tsx と同じ手。
  正は IndexedDB 側で、こちらは描き始めのための写し。読めなくても動く。
*/
export const FLOWER_LS_KEY = "mb.flower";

function mirrorFlowerToLocalStorage(on: boolean): void {
  try {
    if (on) localStorage.removeItem(FLOWER_LS_KEY);
    else localStorage.setItem(FLOWER_LS_KEY, "off");
  } catch {
    // private モードなどで書けないことがある。表示は IndexedDB 側で合う。
  }
}

export async function saveFlowerSetting(value: FlowerSetting): Promise<void> {
  await setSetting(SETTING_KEY.flowerFrame, value);
  mirrorFlowerToLocalStorage(value.on);
  if (value.on) document.documentElement.removeAttribute("data-flower");
  else document.documentElement.dataset.flower = "off";
}

export async function loadBackgroundSetting(): Promise<BackgroundSetting | null> {
  try {
    return parseBackgroundSetting(await getSetting<unknown>(SETTING_KEY.background, null));
  } catch {
    return null;
  }
}

/** 設定が変わったことを背景レイヤーに知らせる。設定画面で選んだらその場で見える。 */
export const DECOR_EVENT = "mb:decor";

export function notifyDecorChanged(): void {
  window.dispatchEvent(new Event(DECOR_EVENT));
}

/* ---- レイヤー -------------------------------------------------------- */

type Photo = { url: string; plan: ScrimPlan };

export default function Background() {
  /*
    初期値は既定（オン）。null から始めて「読み込めたら出す」にすると、
    既定で使う人の画面で花が一瞬あとから出る。既定は on なので既定で描き始める。
    オフの人は上のスクリプト＋CSSが最初のフレームから隠している。
  */
  const [flower, setFlower] = useState<FlowerSetting>(FLOWER_DEFAULT);
  const [photo, setPhoto] = useState<Photo | null>(null);

  /*
    blob: の URL は作った数だけ残る。data URL を使わない代わりに、
    差し替えと後片付けで必ず revoke する（§4.9 の表「表示方法」）。
  */
  const urlRef = useRef<string | null>(null);
  const revoke = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const load = useCallback(async () => {
    const next = await loadFlowerSetting();
    setFlower(next);

    const setting = await loadBackgroundSetting();
    if (!setting) {
      revoke();
      setPhoto(null);
      return;
    }
    let stored = null;
    try {
      stored = await getImage(IMAGE_ID.background);
    } catch {
      stored = null;
    }
    if (!stored) {
      /*
        設定は「写真あり」なのに画像がない。バックアップを別の端末で読み込んだ
        あとに起こりうる（写真はバックアップに入れていない → lib/backup.ts）。
        嘘の状態を残さないよう、設定を消して「写真なし」に戻す。
      */
      try {
        await setSetting(SETTING_KEY.background, null);
      } catch {
        // 消せなくても表示は「写真なし」。次に開いたときまた試す。
      }
      revoke();
      setPhoto(null);
      return;
    }
    const url = URL.createObjectURL(storedImageToBlob(stored));
    revoke();
    urlRef.current = url;
    setPhoto({ url, plan: setting.plan });
  }, [revoke]);

  useEffect(() => {
    void load();
    const onChange = () => void load();
    window.addEventListener(DECOR_EVENT, onChange);
    return () => {
      window.removeEventListener(DECOR_EVENT, onChange);
      revoke();
    };
  }, [load, revoke]);

  /*
    文字色の差し替え。
    不透明なカードの外にある文字（見出し・補助文・リンク）は写真の上に乗るので、
    計算した文字色に替える必要がある。どの文字が対象かは globals.css の
    :root[data-bg="photo"] の規則にまとめてある（カードの中は元の色のまま）。
  */
  useEffect(() => {
    const root = document.documentElement;
    if (!photo) {
      root.removeAttribute("data-bg");
      root.style.removeProperty("--scrim-ink");
      return;
    }
    root.dataset.bg = "photo";
    root.style.setProperty("--scrim-ink", photo.plan.cssVars["--scrim-ink"]);
    return () => {
      root.removeAttribute("data-bg");
      root.style.removeProperty("--scrim-ink");
    };
  }, [photo]);

  return (
    <>
      {photo && (
        <div
          className="bg-photo"
          aria-hidden="true"
          style={{ backgroundImage: `url("${photo.url}")` }}
        />
      )}
      {photo && photo.plan.opacity > 0 && (
        <div
          className="bg-scrim"
          aria-hidden="true"
          style={{ background: photo.plan.scrimBackground }}
        />
      )}
      <div className="bg-decor">
        {flower.on && <FlowerFrame density={flower.density} palette={flower.palette} />}
      </div>
    </>
  );
}
