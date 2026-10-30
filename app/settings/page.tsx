"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import StorageCheck from "../storage-check";
import TextSize from "../text-size";
import {
  loadBackgroundSetting,
  loadFlowerSetting,
  notifyDecorChanged,
  saveFlowerSetting,
  type BackgroundSetting,
  type FlowerSetting,
} from "../background";
import type { FlowerDensity, FlowerPalette } from "../flower-frame";
import { backupFileName, buildBackup, parseBackup, restoreBackup } from "@/lib/backup";
import {
  deleteImage,
  getAllTxns,
  getSetting,
  IMAGE_ID,
  putImage,
  SETTING_KEY,
  setSetting,
} from "@/lib/db";
import { ACCEPT_IMAGE, formatBytes, ImageError, prepareBackground } from "@/lib/image";
import { formatAmount, money, parseAmount } from "@/lib/money";

export default function Settings() {
  const [budgetText, setBudgetText] = useState("");
  const [savedBudget, setSavedBudget] = useState<number | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const [b, txns, last] = await Promise.all([
          getSetting<number | null>("budgetMinor", null),
          getAllTxns(),
          getSetting<string | null>("lastBackupAt", null),
        ]);
        setSavedBudget(b);
        setBudgetText(b === null ? "" : String(b));
        setCount(txns.length);
        setLastBackupAt(last);
      } catch {
        setMessage({ kind: "warn", text: "設定を読み込めませんでした。" });
      }
    })();
  }, []);

  const saveBudget = async () => {
    // 全角数字・カンマ・「円」を受け入れる（日本語IMEは全角を常時生成する）
    const parsed = parseAmount(budgetText);
    if (parsed === null || parsed.amountMinor <= 0) {
      setMessage({ kind: "warn", text: "金額を入力してください（例：90000）" });
      return;
    }
    try {
      await setSetting("budgetMinor", parsed.amountMinor);
      setSavedBudget(parsed.amountMinor);
      setBudgetText(String(parsed.amountMinor));
      setMessage({ kind: "ok", text: `今月の予算を ${formatAmount(parsed)} にしました。` });
    } catch {
      setMessage({ kind: "warn", text: "保存できませんでした。" });
    }
  };

  /*
    書き出し。iOS では共有シートから「ファイルに保存」でiCloud Driveに置ける。
    共有に対応していない場合はダウンロードに落とす。
    途中でやめた場合は「書き出した」と記録しない。
  */
  const exportBackup = async () => {
    try {
      const data = await buildBackup();
      const text = JSON.stringify(data, null, 2);
      const name = backupFileName();
      const file = new File([text], name, { type: "application/json" });

      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "moneyBAGS のバックアップ" });
      } else {
        const url = URL.createObjectURL(file);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      }

      const now = new Date().toISOString();
      await setSetting("lastBackupAt", now);
      setLastBackupAt(now);
      setMessage({ kind: "ok", text: `${data.txns.length}件の記録を書き出しました。` });
    } catch (e) {
      // 共有シートを閉じただけなら失敗扱いにしない
      if (e instanceof DOMException && e.name === "AbortError") return;
      setMessage({ kind: "warn", text: "書き出せませんでした。" });
    }
  };

  /*
    読み込み。同じ id は上書き、ない id は追加。消しはしない。
    「読み込んだら今のデータが消えた」が一番やってはいけないこと。
  */
  const importBackup = async (file: File) => {
    try {
      const parsed = parseBackup(await file.text());
      if (!parsed.ok) {
        setMessage({ kind: "warn", text: parsed.reason });
        return;
      }
      const { added, replaced } = await restoreBackup(parsed.data);
      const txns = await getAllTxns();
      setCount(txns.length);
      setSavedBudget(await getSetting<number | null>("budgetMinor", null));
      setMessage({
        kind: "ok",
        text: `${added}件を追加し、${replaced}件を上書きしました。元からあった記録は消していません。`,
      });
    } catch {
      setMessage({ kind: "warn", text: "読み込めませんでした。" });
    }
  };

  return (
    <main className="wrap">
      <header className="between">
        <h1 className="h1">設定</h1>
        <Link href="/" className="link">
          ホームへ
        </Link>
      </header>

      {message !== null && (
        <section className={message.kind === "warn" ? "card attention" : "card"} aria-live="polite">
          <p style={{ fontSize: "var(--fs-body)", lineHeight: "var(--lh-body)" }}>{message.text}</p>
        </section>
      )}

      <section className="card">
        <h2 className="h2">今月の予算</h2>
        <p className="sub" style={{ marginBottom: 10 }}>
          1ヶ月にいくらまで使うか。あとから変えられます。
        </p>
        <input
          type="text"
          inputMode="numeric"
          className="field"
          placeholder="90000"
          value={budgetText}
          onChange={(e) => setBudgetText(e.target.value)}
          aria-label="今月の予算"
        />
        <div style={{ marginTop: 8 }}>
          <button type="button" className="btn" onClick={saveBudget}>
            予算を保存する
          </button>
        </div>
        {savedBudget !== null && (
          <p className="note divider">
            いまの予算：{formatAmount(money(savedBudget))}
          </p>
        )}
      </section>

      <section className="card">
        <h2 className="h2">バックアップ</h2>
        <p style={{ fontSize: "var(--fs-body)", lineHeight: "var(--lh-body)" }}>
          記録はこの端末の中だけにあります。iPhone
          はしばらく使わないと保存データを消すことがあるので、ときどき書き出してください。
        </p>

        <div className="stack" style={{ marginTop: 12 }}>
          <button type="button" className="btn primary" onClick={exportBackup}>
            バックアップを書き出す
          </button>
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
            バックアップを読み込む
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importBackup(f);
              e.target.value = "";
            }}
          />
        </div>

        <p className="note divider">
          書き出すと共有メニューが開きます。「ファイルに保存」を選ぶと iCloud Drive
          に置けます。
          <br />
          読み込んでも、いまある記録は消えません。同じ記録だけ上書きされます。
          {count !== null && (
            <>
              <br />
              いまの記録：{count}件
            </>
          )}
          {lastBackupAt !== null && (
            <>
              <br />
              最後に書き出したのは {new Date(lastBackupAt).toLocaleString("ja-JP")} です。
            </>
          )}
        </p>
      </section>

      <TextSize />
      <Decoration />
      <StorageCheck />
    </main>
  );
}

/* ---- 背景と花の枠 ----------------------------------------------------

   docs/PLAN.md §4.9。ここは「選んだものがそのまま全画面に出る」ので、
   別にプレビューの小窓を作っていない。設定画面じたいが結果の表示になる
   （小窓と本番でずれるほうが混乱する。可読性の判定も画面の大きさを使って
   計算しているので、縮小した小窓で見せると嘘になる）。
*/

const DENSITY_OPTIONS: { value: FlowerDensity; label: string }[] = [
  { value: "sparse", label: "少なめ" },
  { value: "normal", label: "標準" },
  { value: "lush", label: "たっぷり" },
];

const PALETTE_OPTIONS: { value: FlowerPalette; label: string }[] = [
  { value: "soft", label: "やさしい" },
  { value: "warm", label: "あたたかい" },
  { value: "cool", label: "すずしい" },
];

/*
  花の「ない」は density: "none" でも表せるが、オン/オフと二重になる。
  同じことを2通りで言える設定は、どちらが効いているか分からなくなるので、
  画面にはオン/オフだけ出し、密度は3段階にしてある。
*/

/** .wrap の max-width。文字が乗る範囲の幅を出すのに使う（globals.css と同じ値）。 */
const WRAP_MAX = 430;

/*
  測る範囲を外に広げる余裕（画面px）。
  アドレスバーの出入りで画面の高さは数十px変わるし、スクロールで文字の位置も動く。
  狭く測って足りない覆いを選ぶのが一番危ないので、広い側に倒す。
*/
const MEASURE_PAD = 24;

function Decoration() {
  const [flower, setFlower] = useState<FlowerSetting | null>(null);
  const [bg, setBg] = useState<BackgroundSetting | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      setFlower(await loadFlowerSetting());
      setBg(await loadBackgroundSetting());
    })();
  }, []);

  const applyFlower = async (next: FlowerSetting) => {
    setFlower(next);
    try {
      await saveFlowerSetting(next);
      notifyDecorChanged();
    } catch {
      setNote({ kind: "warn", text: "設定を保存できませんでした。表示は変わっています。" });
    }
  };

  /*
    写真を取り込む。縮小 → 文字が乗る場所の明るさを測る → 覆いの計画を立てる、
    までを lib/image.ts がやる。測るのは**ここだけ**で、以後は保存した計画を使う。
  */
  const choosePhoto = async (file: File) => {
    setBusy(true);
    setNote(null);
    try {
      /*
        文字が乗る範囲を画面座標で出す。.wrap は max-width 430px の中央寄せなので、
        画面がそれより広いと左右は写真だけが見える（文字が乗らない）。
        その外側まで測ると、使われない場所の明るさで覆いの濃さが決まってしまう。
        画面座標から画像の画素座標への変換は lib/image.ts の
        screenRectToImageRegion がやる（cover で切られる分の計算はそこ）。
      */
      const view = { width: window.innerWidth, height: window.innerHeight };
      const column = Math.min(view.width, WRAP_MAX);
      const textRect = {
        x: (view.width - column) / 2,
        // 縦は画面全部。背景は固定でページだけ動くので、
        // スクロールすれば文字は画面のどの高さにも来る。
        y: 0,
        width: column,
        height: view.height,
      };

      const prepared = await prepareBackground(file, { view, textRect, pad: MEASURE_PAD });
      const plan = prepared.plan;

      /*
        覆いの上限（0.8）まで濃くしても 4.5:1 に届かなかった写真。
        半端に濃い膜をかけて「適用できたことにする」のが一番まずいので、
        適用せずに事実を伝える。lib/readability.ts の方針6そのまま。
      */
      if (plan.fallbackToSurface) {
        setNote({
          kind: "warn",
          text:
            "この写真は文字の下に向きません。明るいところと暗いところの差が大きすぎて、覆いをかけても文字が読める濃さ（4.5:1）になりませんでした。写真は保存していません。明るさのむらが少ない写真だとうまくいきます。",
        });
        return;
      }

      await putImage(IMAGE_ID.background, prepared.stored);
      const setting: BackgroundSetting = {
        plan,
        width: prepared.stored.width,
        height: prepared.stored.height,
        bytes: prepared.bytes,
        importedAt: new Date().toISOString(),
      };
      await setSetting(SETTING_KEY.background, setting);
      setBg(setting);
      notifyDecorChanged();

      const pct = Math.round(plan.opacity * 100);
      setNote({
        kind: "ok",
        text:
          pct === 0
            ? "背景にしました。この写真はそのままで文字が読めるので、覆いをかけていません。"
            : `背景にしました。文字が読めるように ${pct}% の覆いをかけています（文字とのコントラストは ${plan.worstContrast.toFixed(1)}:1）。`,
      });
    } catch (e) {
      if (e instanceof ImageError) {
        setNote({ kind: "warn", text: e.message });
      } else if (e instanceof DOMException && e.name === "QuotaExceededError") {
        setNote({
          kind: "warn",
          text: "この端末の保存できる容量がいっぱいで、写真を保存できませんでした。",
        });
      } else {
        setNote({ kind: "warn", text: "写真を背景にできませんでした。" });
      }
    } finally {
      setBusy(false);
    }
  };

  const removePhoto = async () => {
    try {
      await deleteImage(IMAGE_ID.background);
      await setSetting(SETTING_KEY.background, null);
      setBg(null);
      notifyDecorChanged();
      setNote({ kind: "ok", text: "背景の写真を消しました。" });
    } catch {
      setNote({ kind: "warn", text: "写真を消せませんでした。" });
    }
  };

  return (
    <section className="card">
      <h2 className="h2">背景と花の枠</h2>
      <p className="sub" style={{ marginBottom: 12 }}>
        選ぶとこの画面がすぐ変わります。どの画面でも同じ飾りになります。
      </p>

      {note !== null && (
        <p
          aria-live="polite"
          className={note.kind === "warn" ? "card attention" : "card"}
          style={{ fontSize: "var(--fs-body)", lineHeight: "var(--lh-body)", marginBottom: 12 }}
        >
          {note.text}
        </p>
      )}

      <h3 className="h2" style={{ fontSize: "var(--fs-body)" }}>
        花の枠
      </h3>
      <div role="radiogroup" aria-label="花の枠" className="row" style={{ margin: "8px 0 12px" }}>
        {[
          { on: true, label: "つける" },
          { on: false, label: "つけない" },
        ].map((o) => (
          <button
            key={String(o.on)}
            type="button"
            role="radio"
            aria-checked={flower !== null && flower.on === o.on}
            className="chip"
            style={{ flex: "1 1 0" }}
            onClick={() => flower && void applyFlower({ ...flower, on: o.on })}
          >
            {o.label}
          </button>
        ))}
      </div>

      {flower !== null && flower.on && (
        <>
          <h3 className="h2" style={{ fontSize: "var(--fs-body)" }}>
            花の数
          </h3>
          <div role="radiogroup" aria-label="花の数" className="grid-3" style={{ margin: "8px 0 12px" }}>
            {DENSITY_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={flower.density === o.value}
                className="chip"
                onClick={() => void applyFlower({ ...flower, density: o.value })}
              >
                {o.label}
              </button>
            ))}
          </div>

          <h3 className="h2" style={{ fontSize: "var(--fs-body)" }}>
            花の色
          </h3>
          <div role="radiogroup" aria-label="花の色" className="grid-3" style={{ margin: "8px 0 12px" }}>
            {PALETTE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={flower.palette === o.value}
                className="chip"
                onClick={() => void applyFlower({ ...flower, palette: o.value })}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="divider">
        <h3 className="h2" style={{ fontSize: "var(--fs-body)" }}>
          背景の写真
        </h3>
        <p className="sub" style={{ margin: "4px 0 10px" }}>
          写真を1枚えらべます。文字が読めるように、写真の明るさを測って自動で覆いをかけます。写真はこの端末の中だけに保存されます。
        </p>

        <div className="stack">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => photoInput.current?.click()}
          >
            {busy ? "読み込んでいます…" : bg === null ? "写真をえらぶ" : "別の写真にする"}
          </button>
          {bg !== null && (
            <button type="button" className="btn small" onClick={() => void removePhoto()}>
              写真を消す
            </button>
          )}
        </div>

        {/*
          accept は image/* だけ。image/heic を足してはいけない
          （Safari 17+ で、JPEG を選んだのに .heic で届くバグがある）。
          capture も付けない（付けるとカメラが直接開いてフォトライブラリが選べない）。
          multiple も付けない（背景は1枚）。
        */}
        <input
          ref={photoInput}
          type="file"
          accept={ACCEPT_IMAGE}
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void choosePhoto(f);
            // 同じ写真をもう一度選べるように空にする
            e.target.value = "";
          }}
        />

        {bg !== null && (
          <p className="note divider">
            いまの写真：{bg.width}×{bg.height}（{formatBytes(bg.bytes)}）
            <br />
            覆いの濃さ：{Math.round(bg.plan.opacity * 100)}%／文字とのコントラスト：
            {bg.plan.worstContrast.toFixed(1)}:1（4.5:1 以上あれば本文が読めます）
            {bg.plan.unevenBackground && (
              <>
                <br />
                明るいところと暗いところの差が大きい写真なので、覆いが濃めになっています。
              </>
            )}
          </p>
        )}
      </div>
    </section>
  );
}
