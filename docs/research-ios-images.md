# moneyBAGS — iOS/Safari 画像処理 調査レポート

調査日: 2026-10-30 / 調査者: 調査担当エージェント
対象: iPhone 専用・GitHub Pages 配信・サーバーなし（IndexedDB のみ）の家計アプリに、利用者の写真を背景画像として追加する機能 + 将来の欲しいものリスト写真

---

## 確度ラベルの定義

| ラベル | 意味 |
|---|---|
| **[A] 一次情報で確認** | 公式仕様 / WebKit ソースコード / Apple 公式ドキュメント / MDN browser-compat-data を直接取得して確認 |
| **[B] 複数の二次情報が一致** | 公式ブログの引用・複数のバグトラッカー・複数の開発者報告が同じことを言っている |
| **[C] 1件のみ** | ブログ1件、フォーラム投稿1件など。裏が取れていない |
| **[D] 推測** | 調査担当の推論。検証されていない |
| **[X] 確認できなかった** | 調べたが情報源が見つからなかった。実機確認が必要 |

## 調査環境の制約（重要）

このセッションのネットワークは許可ドメインが限られており、**以下は取得できませんでした**:
`webkit.org` / `bugs.webkit.org` / `developer.mozilla.org` / `caniuse.com` / `zenn.dev` / `pqina.nl` / `mail-archive.com` / `dev.to` / `stackoverflow.com`

直接取得できたのは `github.com` / `raw.githubusercontent.com` / `developer.apple.com` / `registry.npmjs.org` のみです。
そのため **一次情報は以下の方法で取りました**:

- **WebKit の現在のソースコード**を `raw.githubusercontent.com` から直接取得（`WKFileUploadPanel.mm`, `UnifiedWebPreferences.yaml`）
- **MDN browser-compat-data** を npm レジストリから取得（`@mdn/browser-compat-data@8.1.7`）してバージョン情報を機械的に抽出
- **npm パッケージの実ファイル**をダウンロードして raw/gzip サイズを実測
- それ以外は WebSearch（ページ本文を要約して返すモード）経由の二次情報

`webkit.org` のブログ本文などは要約引用に頼っています。該当箇所は確度を落としています。

---

# 1. HEIC の扱い【最重要】

## 1-1. 結論（先に読んでください）

**変換は「ほぼ不要」だが「ゼロではない」。**

| 写真の選び方 | 渡ってくる形式 | 確度 |
|---|---|---|
| 「フォトライブラリ」（Photo Library） | **JPEG に変換されて渡る**（HEIC/ProRAW/HDR すべて） | **[A]** WebKit ソース |
| 「写真を撮る」（Take Photo） | **JPEG**（品質 0.8 で再エンコード） | **[A]** WebKit ソース |
| 「ファイルを選択」（Choose Files） | **変換されない。`.heic` はそのまま届く** | **[A]** WebKit ソース |

つまり **`accept` の値に関係なく、フォトライブラリ経由なら JPEG**。
しかし **「ファイルを選択」経由では HEIC が素で届く**ので、HEIC を完全に無視する実装は壊れます。

> **実装担当はどうすべきか**: HEIC デコーダ（WASM/asm.js）は**既定でバンドルしない**。まず `createImageBitmap(file)` を試し、失敗したときだけ「写真アプリから選び直してください」と案内する（またはその時点で初めてデコーダを遅延ロードする）。

## 1-2. 一次情報：WebKit のソースコードが示す正確なロジック

`Source/WebKit/UIProcess/ios/forms/WKFileUploadPanel.mm`（main ブランチ, 2026-10-30 時点）の `_preferredAssetRepresentationMode` が判定しています。**[A]**

判定順序:

1. デリゲートが `fileUploadPanelPhotoPickerPrefersOriginalImageFormat:` を実装していない、または `NO` を返す → `PHPickerConfigurationAssetRepresentationModeCompatible`（= 変換する）
2. `_acceptedUTIs` が空 → `...ModeCurrent`（= 元の形式のまま）
3. `_acceptedUTIs` が `UTTypeImage.identifier` を含む → `...ModeCurrent`
4. それ以外 → `...ModeCompatible`

そしてデリゲートが返す値は、WebKit の内部設定 `PhotoPickerPrefersOriginalImageFormat` の値です。
`Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml`（main, 2026-10-30 に実取得）には:

```yaml
PhotoPickerPrefersOriginalImageFormat:
  type: bool
  status: internal
  humanReadableName: "Photo Picker Prefers Original Image Format"
  humanReadableDescription: "Prefer the original image format when selecting photos for file upload"
  condition: HAVE(PHOTOS_UI)
  excludeFrom: [ WebKitLegacy, WebCore ]
  defaultValue: false
```

**`defaultValue: false`** なので判定は**必ず 1 で止まり、常に `Compatible`（変換する）になります**。**[A]**

つまり **`accept` 属性を何にしても、フォトライブラリ経由は変換される**。これは古い検証記事（Zenn, iOS Safari 604.1）や 2020 年の HN コメントの観測と一致します。**[B]**

### 経緯（バージョンによる違い）

- **~2024年3月**: WebKit bug 267277 / commit `0f76043f7852`「[iOS] Avoid transcoding images on file inputs unless the set of image types is explicitly restricted」が `PhotoPickerPrefersOriginalImageFormat` を **既定 `true`** で追加。これが有効なら `accept="image/*"` で **HEIC が素のまま渡る**挙動になるはずでした。**[A]**（GitHub のコミットページを直接確認）
- **2024-04-30**: WebKit bug 273444 / commit `687fbeefa898`（作者 Aditya Keerthi）「[iOS] Unable to upload photos to Adobe Express app」が、**既定値を `false` に戻しました**。コミットメッセージは「restores the old behavior」。Adobe Express が `image/*` を指定しつつ HEIC を受け付けられないため、という理由。**[A]** / 日付は **[B]**（検索結果の要約経由）
- cherry-pick `5b0e147c0955` が `safari-7618.2.12.10-branch`（Safari 17.4/17.5 系）に入っています。**[A]**

> 重要: `true` だった期間はおよそ 2024年3〜4月の開発版のみで、**安定版 iOS に `true` が出荷されたかは確認できませんでした [X]**。少なくとも現在の main は `false` で、観測報告（JPEG に変換される）とも一致します。

`status: internal` なので、iOS の 設定 → Safari → 詳細 → Feature Flags に現れる可能性があります（**[D] 未確認**）。利用者が自分で切り替えてしまう余地がゼロとは言えません。

### 「Compatible」が JPEG になる根拠

Apple の `PHPickerConfiguration.AssetRepresentationMode` ドキュメントは
- `compatible` = "uses the most compatible representation if possible"
- `current` = "uses the current representation and avoids transcoding, if possible"
と書くだけで、**JPEG と明言していません [A]（ドキュメント文言）**。
HEIC に対して JPEG になる、というのは多数の開発者報告の一致によるものです **[B]**。

### Safari 17+ の `accept` に `image/heic` を入れると逆に HEIC になるバグ

Apple Developer Forums スレッド（2023年12月投稿、返信は 2024年2月〜2024年11月）**[A]**（スレッド本文を直接取得）:

- `<input type="file" accept="image/*,image/heic">` で `.jpeg` を選ぶと `tempImageHjyd3l.heic` / `type: image/heic` になって届いた
- `lastModified` も書き換わる
- `accept` から `image/heic` を外すと直る
- Chrome 等は `image/heic` を `accept` に入れないと HEIC ファイルを選べない → ブラウザ判定が必要
- **Apple からの公式回答はスレッドにありません**
- WordPress 6.7 がブロックエディタに `accept="image/heic"` を追加して同じ被害が出た報告あり

> **実装担当はどうすべきか**: **`accept` に `image/heic` / `image/heif` を書かないでください**。iOS では不要（フォトライブラリは常に JPEG）で、書くと上記の逆変換バグを踏みます。iPhone 専用アプリなので Chrome 対応のためのブラウザ分岐も不要です。

## 1-3. `canvas` / `createImageBitmap` で HEIC をデコードできるか

- **Safari 17.0 が HEIC 画像のサポートを追加**: WebKit 公式ブログ "WebKit Features in Safari 17.0" に「Safari 17.0 also adds support for HEIC images」とある。**[B]**（webkit.org を直接取得できなかったため、検索の要約引用）
- `<img>` タグで表示できる（macOS Sonoma 以降の Safari 17、iOS 17 / iPadOS 17）: 二次情報のみ **[B]**
- `createImageBitmap` / `canvas.drawImage` でデコードできる: 開発者ブログと `heic-normalize` の README が「Safari は OS コーデックを使うので createImageBitmap でネイティブにデコードできる」と書いているが、**公式ドキュメントも実機テスト結果も見つからず [C]**
- **iOS Safari（macOS ではなく）での実機確認結果は見つかりませんでした [X]**

> **実装担当はどうすべきか**: HEIC デコードを「できる前提」で設計せず、**実機で Orientation 付き HEIC を 1 枚用意して `createImageBitmap(file)` が解決するか確認してください**。できるなら変換コードは一切不要です。

## 1-4. WebAssembly 版 libheif は現実的か（サイズ実測）

npm から実ファイルをダウンロードして実測しました。**[A]**

| パッケージ | 最新版 / 公開日 | ブラウザに届くサイズ | 形式 |
|---|---|---|---|
| `heic2any` | **0.0.4 / 2023-03-29** | `dist/heic2any.min.js` = **1,351,840 B（1.29 MiB）raw / 337,605 B（330 KiB）gzip** 単一ファイル | **asm.js（WASM ではない）** |
| `libheif-js`（wasm ビルド） | 1.23.5 / 2026-10-04 | glue `libheif.js` 91,255 B（29,054 gz）+ `libheif.wasm` 1,463,506 B（**482,812 B ≈ 472 KiB gzip**）= **約 500 KiB gzip** | 真の WebAssembly |
| `libheif-js`（asm.js ビルド） | 同上 | `libheif/libheif.js` 3,189,493 B（764,216 B gzip） | asm.js |
| `heic-to` | 1.6.7 / 2026-10-27 | unpacked 26 MB（複数ビルド同梱）。`heic-normalize` が使うラッパ | wasm/asm 両方 |

**重要な発見**: `heic2any@0.0.4` には文字列 `WebAssembly` が1回も出てこず、`data:application/octet-stream;base64,...` を埋め込んでいます。つまり **WASM ではなく asm.js ビルド**です。**[A]（実測）** asm.js は WASM より明確に遅いので、「WebAssembly 版 libheif」として heic2any を選ぶのは不適切です。また最終リリースが 2023年3月で、実質メンテナンスされていません。

### 速度

- iOS Safari での信頼できるベンチマークは**見つかりませんでした [X]**
- 報告されている数字はばらばら: 12MP の HEIC で heic2any ~1,800 ms（デスクトップ）、libheif-js ~3,500 ms（モバイル）という比較、「画像サイズ次第で 200ms〜1s」という別の記述 **[C]**
- 「ネイティブデコードは JS/WASM より 17〜39 倍速い」という主張あり（方法論の記載なし）**[C]**
- Playwright WebKit（macOS）で 12MP が 71 ms という計測 **[C]**（著者自身が「Safari 実機も iOS もテストしていない」と注記）

> **実装担当はどうすべきか**: HEIC デコーダは**初期バンドルに入れず**、`createImageBitmap` が失敗した場合のみ `libheif-js` の **wasm ビルド**（約 500 KiB gzip）を動的 import する。GitHub Pages なので `.wasm` が `application/wasm` で配信されるかも確認が必要（**[X]** 未確認）。moneyBAGS の規模なら、デコーダを積まずに「写真アプリから選んでください」と案内する方が合理的だと考えます **[D]**。

---

# 2. 写真の選択UI

## 2-1. `<input type="file" accept="image/*">` を押すと何が出るか

`WKFileUploadPanel.mm` の `presentWithParameters:` を読んだ結果 **[A]**:

1. `accept` → UTI 変換（`UTIsForMIMETypes`）: `image/*` → `UTTypeImage`、`video/*`・`audio/*` → `UTTypeMovie`、`*/*` → 空集合
2. 受理 UTI が空なら画像も動画も許可される
3. `mediaCaptureType`（= `capture` 属性）が設定されていてカメラが使えるなら、**メニューを出さずに `_showCamera` を直接呼ぶ**
4. そうでなければ `showDocumentPickerMenu`。ディレクトリ非許可かつ画像または動画が受理されるなら、**「フォトライブラリ / 写真を撮る（Photo Library, Take Photo or Video, Choose Files）」のメニュー**を出す。該当しなければ直接ドキュメントピッカー
5. **フォトライブラリ** → `PHPickerViewController`（画像/動画のどちらか片方だけ許可のときだけフィルタを設定）
6. **ファイルを選択** → `UIDocumentPickerViewController`（受理 UTI、なければ `UTTypeItem`）。デリゲートは**ファイルを一時ディレクトリにコピー/移動してそのまま渡す = 画像の変換はしない**
7. **カメラ** → `UIImagePickerController`（カメラソース）。画像 URL がない写真は `_uploadItemForJPEGRepresentationOfImage` で **JPEG 品質 0.8** に変換される

このファイル内で動画以外の変換処理は存在せず、動画のみ `WKFileUploadMediaTranscoder` で QuickTime に書き出されます。**[A]**

## 2-2. `capture` 属性の影響

- MDN browser-compat-data **[A]**: `html.elements.input.capture` → **iOS Safari 10 以降でサポート、macOS Safari は非サポート**
- WebKit ソース **[A]**: `mediaCaptureType` が設定されていれば**選択メニューをスキップして直接カメラを開く**。前面/背面は `mediaCaptureType` から決まる
- 「iOS では capture を指定してもピッカーが出る」という古い記述もありますが **[C]**、現在のソースは直接カメラを開く実装です

> **実装担当はどうすべきか**: 背景画像は既存の写真から選ぶ機能なので **`capture` は付けないでください**（付けるとフォトライブラリが選べなくなる）。

## 2-3. 複数選択

- MDN BCD **[A]**: `html.elements.input.multiple` → iOS Safari 3.2 以降
- WebKit ソース **[A]**: ドキュメントピッカーは `setAllowsMultipleSelection:`、PHPicker は `selectionLimit = 0`（無制限）/ `1`。カメラ利用時は単一アイテムのデリゲートが処理する
- `accept` について MDN BCD の注記 **[A]**: iOS Safari は `accept` を v1 からサポートするが **`audio/*` MIME タイプは非対応**（webkit.org/b/242110）

> **実装担当はどうすべきか**: 背景は 1 枚なので `multiple` 不要。欲しいものリストで複数登録したいなら `multiple` を付けてよい（無制限選択になるので、JS 側で枚数上限を設けること）。

## 2-4. PWA（ホーム画面から起動）での違い

- **ファイル入力の挙動が standalone と Safari で違うかを直接比較した情報源は見つかりませんでした [X]**
- WebKit エンジンは同一なので同じ挙動になると推測されます **[D]**
- ホーム画面 PWA では**ストレージが Safari と分離される**（インストール時に一度 Cookie がコピーされ、以後は別管理）という記述あり **[C]**
- 「表示モードが standalone のときに iOS でカメラが使えなかったが iOS 18 以降で修正された」という報告あり **[C]**。`capture` を使わないなら影響しません

> **実装担当はどうすべきか**: standalone（ホーム画面起動）での写真選択は**必ず実機で確認してください**。特に「写真を撮る」が機能するかどうか。

---

# 3. 画像の縮小

## 3-1. `canvas.toBlob()` と WebP

MDN browser-compat-data v8.1.7 を直接取得して確認 **[A]**:

| API | iOS Safari | macOS Safari |
|---|---|---|
| `HTMLCanvasElement.toBlob` | **11** | 11 |
| `toBlob` の `type` に `"image/webp"` | **❌ 非対応（`false`）** | ❌ 非対応 |
| `toDataURL` の `type` に `"image/webp"` | **❌ 非対応（`false`）** | ❌ 非対応 |
| `createImageBitmap` | **15** | 15 |
| `createImageBitmap` の `imageOrientation` | **15** | 15 |
| `createImageBitmap` の `resizeQuality` | **15** | 15 |
| `createImageBitmap` の `resizeWidth` | **15** | 15 |
| `OffscreenCanvas` | **16.4** | 16.4 |

caniuse も同様に Safari / iOS Safari を全バージョン非対応としています **[B]**。
Safari 14 で追加されたのは **WebP のデコード**（表示）であって**エンコードではありません [B]**。

**致命的な落とし穴**: HTML 仕様により、要求した type が未対応の場合 UA は **PNG で出力します**（エラーにならない）。つまり iOS で `toBlob(cb, 'image/webp')` を呼ぶと**黙って PNG が返ります** **[B]**。写真の PNG は JPEG の数倍のサイズになるので、気づかないと容量を大量に消費します。

> **実装担当はどうすべきか**: **`image/jpeg` を使ってください**（`toBlob(cb, 'image/jpeg', 0.82)` 程度）。WebP を試すなら必ず `blob.type === 'image/webp'` を検査してフォールバックすること。

## 3-2. iOS Safari の canvas サイズ上限

- 最も広く報告されている制限は **面積 16,777,216 px（= 4096 × 4096）**。エラーメッセージは `Canvas area exceeds the maximum limit (width * height > 16777216).` **[B]**
- MDN は「iOS デバイスは canvas サイズを 4,096 × 4,096 に制限する」と書いている **[B]**（MDN を直接取得できず、検索の要約引用）
- ただし面積ベースなので、**合計が 16,777,216 未満なら片方の辺が 4096 を超えてもよい**（例: 8192×2048）**[B]**
- Safari 15 で 4096×4096 に下がり、Safari 14 までは 16384×16384 だったという報告 **[C]**
- 「RAM 256MB 未満で 3 メガピクセル、以上で 5 メガピクセル」という Apple の古い記述は陳腐化 **[B]**
- **WebKit の公式ドキュメントは見つかりませんでした [X]**

**moneyBAGS での意味**: 4000 × 3000 = **12,000,000 px < 16,777,216** なので、**最近の iPhone 写真 1 枚なら面積上限は超えません [A]（算術）**。

## 3-3. canvas の合計メモリ上限

別のエラー `Total canvas memory use exceeds the maximum limit (N MB)` が存在し、報告されている N は **224 MB（iOS 12）/ 384 MB（iOS 15.4〜16.4）/ 448 MB（それ以前）** とバージョンで変動 **[B]**。256 MB という値の情報源は見つかりませんでした。

- 原因: 参照が切れた canvas がすぐに GC されない（WebKit bug で iOS 12 について報告）**[C]**
- 回避策: 使い終わった canvas を **1×1 に縮めて clear する**と Safari がメモリを解放する **[C]**（pqina）

4000×3000 の RGBA バックストアは約 **48 MB**。数枚同時に保持すると 384 MB に近づきます。

> **実装担当はどうすべきか**: 縮小用の canvas は**使い回さず 1 個だけ使い、処理後に `canvas.width = canvas.height = 1` にして解放**する。`devicePixelRatio` で backing store を掛け算しないよう、縮小用 canvas には DPR を適用しないこと（画面に出さないので不要）。

## 3-4. 縮小時の品質

- `drawImage` での一発縮小は品質が悪い（エイリアシング）という報告は一致 **[B]**。対策は**段階的縮小（1/2 ずつ halving）**
- `createImageBitmap(blob, { resizeWidth, resizeHeight, resizeQuality: 'high' })` が iOS Safari 15+ で使える **[A]**。ただし HTML 仕様は `resizeQuality` を**ヒント**と定義し、既定値は `'low'`、アルゴリズムは実装依存 **[B]**
- **Safari が `resizeQuality: 'high'` で実際にどの程度きれいになるかは確認できませんでした [X]**
- 古い iOS（iOS 6 時代）には 2 メガピクセル超の画像を canvas に描くとサブサンプリングされるバグがあり `ios-imagefile-megapixel` という回避ライブラリがあったが、**現在の iOS でも起きるかは未確認 [X]**。当該ライブラリは未メンテナンス

> **実装担当はどうすべきか**: `createImageBitmap(file, {resizeWidth, resizeHeight, resizeQuality:'high', imageOrientation:'from-image'})` を第一候補にし、見た目が悪ければ段階的 halving にフォールバック。**実機で両方の出力を見比べて決めてください**。

## 3-5. Worker での処理

- `createImageBitmap` は Worker でも使え、iOS Safari 15+ **[A]**
- `OffscreenCanvas` は iOS Safari **16.4+** **[A]**
- → iOS 16.4 以降なら縮小処理を完全に Worker に追い出せる。16.0〜16.3 を切るかどうかは要判断

---

# 4. EXIF

## 4-1. canvas で再描画すれば EXIF（位置情報含む）が落ちるか

**はい、落ちます。** ただし確度は **[B]** です（仕様に「メタデータを削除する」と書いてあるわけではなく、canvas が画素しか持たないという構造上の必然 + 複数の二次情報の一致）。

- `drawImage` → `toBlob` は**画素から新規にエンコードした別ファイル**なので、EXIF ブロック / IPTC / XMP / **ICC プロファイル**は一切引き継がれません **[B]**
- **副作用として ICC プロファイルも落ちます**。iPhone の写真は Display P3 なので、**色がわずかに変わる可能性があります** **[B]**。背景画像なら実害は小さいと考えますが **[D]**、気になるなら実機で比較してください
- JPEG → canvas → JPEG は**再量子化による世代劣化**が起きます **[C]**
- バイト列から EXIF/XMP セグメントだけを除去する（再エンコードしない）手法もあります **[C]**。ただし回転情報も残るため、縮小が目的の moneyBAGS では不向き

> **実装担当はどうすべきか**: 縮小のために canvas を通す設計なので、**位置情報の除去は自動的に達成されます。別途 EXIF ストリッパーを入れる必要はありません**。ただし「位置情報を消しています」とユーザーに言うなら、実機で出力 Blob を ExifTool 等で検査して確認しておくのが安全です。

## 4-2. 回転情報（Orientation）は自分で適用する必要があるか

### `<img>` 経由 → `drawImage` の場合: **WebKit は自動で適用します [B]**

- WebKit bug 209849 の報告: **Safari 13.1 で、EXIF orientation 付き画像を canvas に描くと `image-orientation: none` でも向きが適用された**。他のブラウザはそうならない **[B]**
- Mozilla bug 1616169 も同じ分裂を記述: 「WebKit では canvas に描いた画像は EXIF orientation を尊重する。Chrome も尊重するが canvas 要素の `image-orientation` が `none` の場合は除く」**[B]**
- 同報告は「最近追加された WPT は canvas 要素の `image-orientation` で決めることを要求しており、WebKit の常時適用と一致しない」とも書いています → **仕様準拠が進めば将来変わる可能性 [D]**
- CSS `image-orientation` は iOS Safari **13.4+** でサポート **[A]**。CSS 仕様の既定値は `from-image` なので `<img>` 表示自体は正しい向きになります

### `createImageBitmap` の場合: **不確実。明示指定してください**

- 仕様: `imageOrientation` の既定は `from-image`（EXIF を適用）、`none` は無視 **[B]**
- **2021年10月時点のブラウザ実測（whatwg/html#7210）**: `{imageOrientation:"none"}` で Firefox と Chrome は EXIF を適用するのに **Safari は無視した**。`"flipY"` では Firefox が「EXIF→flip」、Chrome が「flip→EXIF」、**Safari は flip のみで EXIF 無視** **[A]**（Issue 本文を直接取得）
- その後 **2021-10-19 に WebKit が「Make createImageBitmap() take EXIF orientation into account correctly」をコミット**し、WPT も追加（WebKit bug 231063）**[A]**
- **現在の iOS Safari の実挙動は確認できませんでした [X]**。仕様自体もまだ未決着（whatwg/html#7210 は open、PR #11234 も open）

> **実装担当はどうすべきか**: **`createImageBitmap(file, { imageOrientation: 'from-image' })` を明示的に書く**。そして **Orientation=6（90度回転）の JPEG と HEIC をそれぞれ実機で通して、二重回転・無回転が起きないか必ず確認してください**。`<img>` + `drawImage` 経路に統一する方が iOS では予測可能です **[D]**。

## 4-3. iOS Safari 固有の注意

- フォトライブラリ経由は PHPicker の Compatible モードで既に再エンコードされているため、**その時点で EXIF がどこまで残るかは確認できませんでした [X]**。Orientation は正規化されている可能性があります（**[D]**）。実機で `File` の先頭バイトを読んで EXIF の有無を確認するのが確実です
- Apple Developer Forums の報告 **[A]**: PHPicker 経由では **`File.lastModified` も書き換わる**。撮影日時を取りたい場合は使えません（`File.lastModified` は iOS Safari 10+ **[A]**）

---

# 5. IndexedDB に Blob を保存すること

## 5-1. iOS Safari で Blob を IndexedDB に入れて取り出せるか

| 状況 | 結論 | 確度 |
|---|---|---|
| 通常ブラウジング（現行 iOS） | **動くと思われるが、一次情報での確認はできなかった** | **[X]** |
| **プライベートブラウズ / ephemeral session** | **WebKit が意図的にエラーを返す**（仕様的な制約。バグではない） | **[B]** |
| 過去（iOS 10.3.1, iOS 12.3.1） | 失敗した報告あり。`DataCloneError`、base64 への変換が必要だった | **[B]** |

- `IDBObjectStore.put` 自体は iOS Safari **8+** **[A]**
- **プライベートブラウズでの既知エラーメッセージ**: `Error preparing Blob/File data to be stored in object store` **[B]**。多数のプロジェクトが同じエラーに遭遇して報告しています
- WebKit のコミット **「Return error when storing blobs in IndexedDB for ephemeral sessions」** が存在し、プライベートモード用のレイアウトテストを追加している **[B]**（コミットタイトル。本文は mail-archive が取得できず未確認）
- 古いバグ: WebKit bug 198278（2019年、iOS 12.3.1 で `DataCloneError`、12.2 では動いた。resolved とマークされたが、報告者は同一バージョンの端末間でも挙動が違うと述べている）**[B]**
- 2017年のコメント: iOS 10.3.1 では Blob だけ base64 に変換する必要があった **[C]**
- **回避策として広く採用されているのは `ArrayBuffer` + MIME 文字列で保存し、読み出し時に `new Blob([buf], {type})` で組み立てる方式** **[B]**。複数の実プロジェクトがこれに移行しています
- `Blob.arrayBuffer()` は iOS Safari **14.5+** **[A]**（それ以前は `FileReader.readAsArrayBuffer`）

> **実装担当はどうすべきか**: **Blob を直接入れず、`{ bytes: ArrayBuffer, type: string, width, height }` の形で保存してください。**これ一つで、プライベートブラウズでの確実な失敗と過去バージョンの不安定さの両方を回避できます。追加コストはほぼゼロです。

## 5-2. 容量の上限

| 対象 | 値 | 確度 |
|---|---|---|
| Safari 17.0 / iOS 17 以降（WebKit "Updates to Storage Policy"） | オリジンごと **総ディスクの最大 60%**、全体で最大 80%。ホーム画面 Web アプリもブラウザと同じオリジン枠 | **[B]** |
| 同（別の検索結果が示した数値） | 「オリジンごと総ディスクの約 20%」「メインフレームのオリジン枠の 10%」 | **[C] 矛盾あり** |
| Safari 17 より前 | オリジンに初期 **1 GiB**、到達後にユーザーに追加許可を求める | **[B]** |
| iOS の WebView（他ブラウザ含む） | 1 GiB で止まり、ユーザーに聞かない | **[C]** |

数値が食い違っているため、**正確な上限は確認できませんでした [X]**。ただし **どの数値でも moneyBAGS には十分**です:

**写真を数十枚入れたらどうなるか**: 縮小後 1 枚 300 KB〜1 MB とすれば 50 枚で **15〜50 MB**。最も保守的な 1 GiB でも 2% 未満。**容量上限は実質的な制約になりません [D]（算術 + 上記の値）**。

## 5-3. `navigator.storage.estimate()` は iOS で信用できるか

- **MDN BCD [A]: `StorageManager.estimate` は iOS Safari 17 以降のみ**。iOS 16 以下では存在しないので、feature detection が必須
- WebKit は「Safari 17.0 / iOS 17 以降で Storage API を完全サポート」と述べている **[B]**
- 仕様上 `estimate()` は "implementation-defined rough estimate" であり、**オリジンの枠と使用量を返すだけで「実際にあと何バイト入るか」は分からない** **[B]**
- あるプロジェクトの報告: **iOS Safari が `quota` に `Number.MAX_SAFE_INTEGER` など非現実的な値を返すことがある**。プライベートブラウズでは Promise が reject される **[C]**
- `StorageManager.persist` は iOS Safari **15.2+** **[A]**

> **実装担当はどうすべきか**: **`estimate()` の戻り値で UI を制御しないでください。**存在チェックと `try/catch`、値の有限性チェック（`Number.isFinite`）を入れた上で、参考表示に留める。実際の限界は **書き込み時の `QuotaExceededError` を捕まえて扱う**こと。

## 5-4. 【スコープ外だが重大】7日ルール

- WebKit "Full Third-Party Cookie Blocking and More"（Safari 13.1 / iOS 13.4、2020-03-24）により、**ITP はユーザー操作のない 7 日後にすべての script-writable storage を削除**します。対象に **IndexedDB** が明記されています **[B]**
- ホーム画面 Web アプリの扱いは情報源が矛盾: WebKit のブログは「home screen apps have their own counter of days of use」、WebKit の tracking-prevention ページは「the first-party domain of home screen web apps is exempt from the seven-day cap」**[B/C] 文言が曖昧**
- `navigator.storage.persist()` が granted されればストレージ圧迫時の eviction から除外される（WebKit は「ホーム画面 Web アプリとして開かれているか」などのヒューリスティックで判定）**[B]**
- **granted された persist が iOS で実際に pressure eviction を生き延びるかは確認できませんでした [X]**

> **実装担当はどうすべきか**: 画像以前の問題として、**(1) 起動時に `navigator.storage.persist()` を呼ぶ、(2) 「ホーム画面に追加」を強く促す、(3) JSON + 画像のエクスポート/インポート機能を用意する** — この3点を背景画像機能より先に入れるべきだと考えます **[D]**。家計データが 7 日で消える可能性があります。

## 5-5. 表示時は `createObjectURL` か `FileReader`（data URL）か

**`URL.createObjectURL` を使ってください。**

| | `URL.createObjectURL` | `FileReader.readAsDataURL` |
|---|---|---|
| iOS Safari | 6+ **[A]** | 6+ **[A]** |
| サイズ | Blob をそのまま参照 | **base64 で約 33% 増** **[B]** |
| メモリ | Blob への参照のみ。revoke するまで保持 **[B]** | 巨大な JS 文字列が GC まで常駐 **[B]** |
| 解放 | `URL.revokeObjectURL()` で明示解放。document unload 時に自動解放されるが明示が推奨 **[B]** | GC 任せ |
| CSS で使う | `background-image: url(blob:...)` | `background-image: url(data:...)` → **CSSOM に巨大文字列が残る [D]** |

- **iOS Safari 固有の比較情報は見つかりませんでした [X]**。上記は一般的なブラウザガイダンスです
- revoke のタイミングは `img.onload` の中、またはコンポーネント破棄時 **[B]**。revoke 済み / object URL でない値に対する revoke は何もしない（無害）**[B]**

> **実装担当はどうすべきか**: IndexedDB から `ArrayBuffer` を読む → `new Blob()` → `createObjectURL` → CSS の `background-image` に設定 → **背景を差し替えるときに必ず古い URL を `revokeObjectURL`**。data URL は使わないこと。

---

# 6. 背景画像としての表示

## 6-1. `background-attachment: fixed` — **使ってはいけません（一次情報で確定）**

MDN browser-compat-data v8.1.7 を直接取得して確認 **[A]**:

```
css.properties.background-attachment.fixed
  iOS Safari: 5 (partial_implementation: true)
  note: "fixed is recognized but has no effect. See bug 275247."
  macOS Safari: 15.4 (完全サポート)
```

**「`fixed` は認識されるが効果がない」**とデータベースに明記されています。WebKit bug 275247。
`background-attachment: local` は iOS Safari 15.4+ **[A]**。

補足（二次情報）:
- caniuse も iOS Safari を全バージョン partial としており、「モバイル端末はスクロール後の fixed 背景の再描画が遅れる」という注記がある **[B]**
- **iOS は fixed 背景を要素ではなくビューポートに合わせてサイズ決定する**ため、`background-size: cover` と併用すると拡大・切り取られる **[B]**
- caniuse の既知バグとして「iOS は `fixed` と `background-size: cover` を組み合わせられない」**[B]**

> **実装担当はどうすべきか**: **`background-attachment: fixed` は書かないでください。** `position: fixed` の専用レイヤーに背景を載せる方式にすること。

## 6-2. `position: fixed` 背景でのちらつき

- **`position: fixed` 要素に背景画像を置いたときのスクロール中のちらつきを、一次情報で裏付ける情報源は見つかりませんでした [X]**
- caniuse の注記「モバイル端末は fixed 背景の再描画が遅れる」は `background-attachment` についてのもの **[B]**
- Apple フォーラムのコメントは再描画コストに起因すると推測、DEV のコメントは「性能上意図的に無効化されている」と述べるが、**どちらも Apple の声明ではありません [C]**
- 日本語記事では、アドレスバーの出入りに伴うカクつきに `transform: translate3d(0, 0, -1px)` が効いたという個人報告がある **[C]**

## 6-3. 推奨パターン（複数の日本語・英語記事が一致 **[B]**）

```css
/* 背景専用レイヤー */
.bg-layer {
  position: fixed;
  inset: 0;
  z-index: 0;                 /* 負の z-index は避ける（後述） */
  background-image: var(--user-bg);   /* blob: URL */
  background-size: cover;
  background-position: center;
  pointer-events: none;
}
/* コンテンツを上に重ねる */
.app-content { position: relative; z-index: 1; }
```

注意点（いずれも **[B]**、個別の報告は **[C]**）:

1. **負の `z-index` を使わない。** 背景要素に負の z-index を付けたら上下に余白が出た、という報告がある。背景は z-index なし（または 0）にして、コンテンツ側に `position: relative; z-index: 1` を与える
2. **`100vh` ではなく `100dvh` / `100svh`。** iOS のアドレスバーの出入りで 100vh がずれる。`inset: 0` を使う上記の形ならそもそも影響を受けにくい
3. **`position: fixed` 要素の祖先に `transform` / `filter` / `will-change` / `perspective` / `overflow: hidden` を付けない。** これらは containing block を作って fixed を壊します
4. 代替案: 親要素の `::before` に背景 + `position: fixed`、親に `clip-path: inset(0)`。iOS 18.1.1 で動いたという報告あり **[C]**
5. 読みやすさのため、背景レイヤーの上にオーバーレイ（`rgba(0,0,0,.35)` や `backdrop-filter: blur()`）を重ねることを推奨 **[D]**

> **実装担当はどうすべきか**: `position: fixed; inset: 0` の背景専用 div + コンテンツ側 `z-index: 1` で実装し、背景画像は `blob:` URL を CSS 変数で差し替える。実機でスクロールしてちらつきが出たら `transform: translateZ(0)` を背景レイヤーに追加して比較する。

---

# 7. 実装担当がやるべきこと — 1行まとめ

| # | 項目 | やること |
|---|---|---|
| 1-1 | HEIC 変換 | 変換コードは既定で入れない。`createImageBitmap(file)` を試し、失敗時だけ案内 or デコーダを遅延ロードする |
| 1-2 | `accept` | **`accept="image/*"` だけにし、`image/heic` を絶対に書かない**（Safari 17+ の逆変換バグ） |
| 1-3 | HEIC デコーダ | 入れるなら `heic2any`（asm.js・2023年で停止）ではなく `libheif-js` の wasm ビルド（約 500 KiB gzip）を動的 import する |
| 2-1 | ピッカー | 「フォトライブラリ / 写真を撮る / ファイルを選択」の3択が出る前提で作る。ファイル経由は HEIC が素で来る |
| 2-2 | `capture` | 付けない（付けるとフォトライブラリが選べなくなる） |
| 2-3 | `multiple` | 背景は不要。欲しいものリストで使うなら JS 側で枚数上限を設ける |
| 3-1 | 出力形式 | `toBlob(cb, 'image/jpeg', 0.8〜0.85)`。WebP は iOS 非対応で黙って PNG になるので使わない |
| 3-2 | canvas サイズ | 面積 16,777,216 px 以下に抑える。12MP 写真 1 枚は範囲内 |
| 3-3 | canvas メモリ | 縮小 canvas は 1 個だけ使い、処理後に 1×1 にして解放する |
| 3-4 | 縮小品質 | `createImageBitmap(file, {resizeWidth, resizeHeight, resizeQuality:'high', imageOrientation:'from-image'})` を第一候補に |
| 3-5 | Worker | iOS 16.4+ なら OffscreenCanvas で Worker 化できる |
| 4-1 | EXIF/GPS | canvas 経由なので自動で落ちる。別途ストリッパーは不要。ICC も落ちて色が変わる点は認識しておく |
| 4-2 | Orientation | `imageOrientation: 'from-image'` を明示し、Orientation=6 の画像で二重回転しないか実機確認する |
| 5-1 | IndexedDB | **Blob を直接入れず `{bytes: ArrayBuffer, type}` で保存する**（プライベートブラウズで確実に失敗するため） |
| 5-2 | 容量 | 写真数十枚なら全く問題にならない。気にしなくてよい |
| 5-3 | `estimate()` | iOS 17+ のみ。参考表示だけに使い、実際の限界は `QuotaExceededError` で扱う |
| 5-4 | 7日ルール | `navigator.storage.persist()` を呼び、ホーム画面追加を促し、エクスポート機能を用意する（画像機能より優先度が高い） |
| 5-5 | 表示 | `createObjectURL` を使い、差し替え時に `revokeObjectURL` する。data URL は使わない |
| 6-1 | 背景 CSS | `background-attachment: fixed` は iOS で**無効**。使わない |
| 6-2 | 背景 CSS | `position: fixed; inset: 0` の専用レイヤー + コンテンツ `z-index: 1`。負の z-index と祖先の transform を避ける |

---

# 8. 実機で確認すべき項目（調査では確認できなかったもの）

テスト端末: 最低 iOS 17 と iOS 18/26 系、Safari 通常・プライベート・ホーム画面 standalone の 3 モード。

## 8-1. HEIC（最優先）
- [ ] **フォトライブラリから HEIC 写真を選んだとき `file.type` / `file.name` / 先頭バイトは何か。**本当に JPEG か（調査の結論は JPEG だが、実機確認が必要）
- [ ] **「ファイルを選択」から iCloud Drive の `.heic` を選んだとき HEIC がそのまま来るか**（WebKit ソースの読みでは来る）
- [ ] HEIC が来たとき `createImageBitmap(heicFile)` が解決するか。`<img src=blob:...>` が表示されるか
- [ ] HEIC が来たとき `canvas.drawImage` + `toBlob('image/jpeg')` で正しい画素が出るか
- [ ] HDR 写真・ProRAW・Live Photo・「グリッド」等の HEIC バリアントで何が来るか
- [ ] 設定 → Safari → 詳細 → Feature Flags に `Photo Picker Prefers Original Image Format` が出るか。ON にすると HEIC が来るようになるか
- [ ] （参考値）12MP HEIC を `libheif-js` wasm でデコードする実時間

## 8-2. ピッカー
- [ ] `accept="image/*"` で実際に出るメニュー項目の文言と数
- [ ] **ホーム画面 standalone と Safari で挙動が違わないか**（特に「写真を撮る」）
- [ ] `accept="image/jpeg,image/png"` にした場合、フォトライブラリが選べるか / HEIC がファイルアプリで選べなくなるか（これが HEIC 完全排除の手になり得る）

## 8-3. 縮小
- [ ] 4000×3000 を縮小するとき `Total canvas memory use exceeds the maximum limit` が出るか。出るなら上限値は何 MB か
- [ ] `createImageBitmap(resizeQuality:'high')` と段階的 halving の画質比較
- [ ] 現行 iOS で 2MP 超のサブサンプリング問題が再現するか（おそらく再現しない）
- [ ] `toBlob('image/webp')` の戻り値の `blob.type`（PNG になるはず）
- [ ] Display P3 写真を canvas 経由にしたときの色の変化の見え方

## 8-4. EXIF
- [ ] Orientation=6 の JPEG を `<img>` + `drawImage` した結果（WebKit は自動適用するはず → 自分で回転させると二重になる）
- [ ] 同じ画像を `createImageBitmap(file, {imageOrientation:'from-image'})` / `'none'` / 無指定の3通りで比較
- [ ] 出力 Blob を ExifTool で検査し、GPS / Orientation / ICC が本当に消えているか
- [ ] フォトライブラリ経由の File に EXIF が残っているか（PHPicker 再エンコード後の状態）
- [ ] `file.lastModified` が撮影日時か処理日時か

## 8-5. IndexedDB
- [ ] 通常ブラウジングで Blob を put/get できるか（できても ArrayBuffer 方式を採用する方針は変えない）
- [ ] プライベートブラウズで `Error preparing Blob/File data to be stored in object store` が再現するか
- [ ] ArrayBuffer 方式がプライベートブラウズで動くか
- [ ] `navigator.storage.estimate()` の実際の戻り値（iOS 17 と 18 で）。非現実的な値を返さないか
- [ ] `navigator.storage.persist()` が granted されるか。Safari と standalone で違うか
- [ ] 50 枚入れたあとの読み出し速度と `estimate()` の usage の増え方
- [ ] 7 日放置して本当に消えるか / ホーム画面追加していると消えないか（時間のかかるテストだが、家計アプリとしては最重要）

## 8-6. 背景
- [ ] `position: fixed; inset: 0` の背景レイヤーでスクロール時にちらつくか
- [ ] アドレスバーの出入りで背景がずれるか（`inset: 0` なら影響を受けないはず）
- [ ] ちらつく場合 `transform: translateZ(0)` が効くか
- [ ] standalone とSafari で差があるか

---

# 9. 情報源

## 一次情報（直接取得して確認）

- WebKit main — `Source/WebKit/UIProcess/ios/forms/WKFileUploadPanel.mm`
  https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/ios/forms/WKFileUploadPanel.mm
- WebKit main — `Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml`（`PhotoPickerPrefersOriginalImageFormat: defaultValue: false`）
  https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml
- WebKit commit `0f76043f7852` — [iOS] Avoid transcoding images on file inputs unless the set of image types is explicitly restricted（bug 267277, pref を既定 true で追加）
  https://github.com/WebKit/WebKit/commit/0f76043f7852
- WebKit commit `5b0e147c0955` — cherry-pick of `687fbeefa898`「[iOS] Unable to upload photos to Adobe Express app」（bug 273444, pref を false に）
  https://github.com/WebKit/WebKit/commit/5b0e147c095567387a080a2da87c79f95ed04744
- WebKit commit `02a5c284178e` — 同 267277 の cherry-pick
  https://github.com/WebKit/WebKit/commit/02a5c284178e4c4c9184cf721954243d59678a03
- WebKit commit `00c3f53f2de4` — Camera RAW files picked via file input are returned as PNG（bug 258467）
  https://github.com/WebKit/WebKit/commit/00c3f53f2de429d9828d9e065dc989d0063b6fc8
- Apple Developer Forums — Safari 17+: Image file got automatically converted to HEIC extension（2023-12 〜 2024-11）
  https://developer.apple.com/forums/thread/743049
- Apple — PHPickerConfigurationAssetRepresentationMode
  https://developer.apple.com/documentation/photokit/phpickerconfigurationassetrepresentationmode
- whatwg/html issue #7210 — Clarify how ImageBitmap interacts with EXIF orientation and image-orientation property
  https://github.com/whatwg/html/issues/7210
- MDN browser-compat-data v8.1.7（npm レジストリから取得して機械抽出）
  https://registry.npmjs.org/@mdn/browser-compat-data
- npm 実測: `heic2any@0.0.4` / `libheif-js@1.23.5` / `heic-to@1.6.7` の tarball

## 二次情報

- WebKit Features in Safari 17.0（HEIC サポート追加）https://webkit.org/blog/14445/webkit-features-in-safari-17-0/ ※直接取得不可
- WebKit — Updates to Storage Policy https://webkit.org/blog/14403/updates-to-storage-policy/ ※直接取得不可
- WebKit — Full Third-Party Cookie Blocking and More（7日ルール）https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/ ※直接取得不可
- WebKit — Tracking Prevention in WebKit https://webkit.org/tracking-prevention/ ※直接取得不可
- WebKit bug 198278（iOS 12 で IndexedDB の Blob 失敗）https://bugs.webkit.org/show_bug.cgi?id=198278 ※直接取得不可
- WebKit bug 212489（macOS の HEIF file input transcoding）https://bugs.webkit.org/show_bug.cgi?id=212489 ※直接取得不可
- WebKit bug 209849（drawImage が EXIF orientation を常に適用）https://bugs.webkit.org/show_bug.cgi?id=209849 ※直接取得不可
- WebKit bug 275247（background-attachment: fixed が iOS で無効）https://webkit.org/b/275247 ※直接取得不可
- Mozilla bug 1616169 — honor intrinsic orientation information in drawImage() https://bugzilla.mozilla.org/show_bug.cgi?id=1616169
- Zenn — Safari は file input に HEIC 画像を入力すると自動的に画像形式を変換することがある https://zenn.dev/kou_pg_0131/articles/safari-input-file-heic ※直接取得不可（検索要約のみ）
- Araluma/heic-normalize（Safari 17+/iOS はネイティブデコード、他は WASM 遅延ロード）https://github.com/Araluma/heic-normalize
- pqina — Canvas Area Exceeds The Maximum Limit https://pqina.nl/blog/canvas-area-exceeds-the-maximum-limit/ ※直接取得不可
- pqina — Total Canvas Memory Use Exceeds The Maximum Limit https://pqina.nl/blog/total-canvas-memory-use-exceeds-the-maximum-limit/ ※直接取得不可
- caniuse — toBlob type webp https://caniuse.com/mdn-api_htmlcanvaselement_toblob_type_parameter_webp ※直接取得不可
- caniuse — background-attachment: fixed https://caniuse.com/mdn-css_properties_background-attachment_fixed ※直接取得不可
- MDN — `<canvas>`（最大サイズ）https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/canvas ※直接取得不可
- MDN — Storage quotas and eviction criteria https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria ※直接取得不可
- Apple Developer Forums — background-attachment:fixed still not supported? https://developer.apple.com/forums/thread/99883
- Apple Developer Forums — Total canvas memory use exceeds the maximum limit (224 MB) https://developer.apple.com/forums/thread/112218
- Apple Developer Forums — Total canvas memory use exceeds the maximum limit - iOS 15 beta https://developer.apple.com/forums/thread/687866
- Hacker News — iOS HEIC→JPEG 変換の議論（2020）https://news.ycombinator.com/item?id=23261216
- react-pdf issue #1149（Canvas area exceeds the maximum limit on iOS）https://github.com/wojtekmaj/react-pdf/issues/1149
- react-pdf issue #1601（384 MB）https://github.com/wojtekmaj/react-pdf/issues/1601
- stomita/ios-imagefile-megapixel（iOS 6 のサブサンプリング問題。未メンテナンス）https://github.com/stomita/ios-imagefile-megapixel
- underpassapp — Detecting private windows in Safari（2025-09、Blob/IndexedDB エラー）https://underpassapp.com/news/2025/9/4.html
- Zenn — iOS Safari で fixed 背景がズレる問題を背景専用レイヤーで解決 https://zenn.dev/hyoni/articles/7bc9ff077e861d ※直接取得不可
- Elementor — Fixed Background Attachment Not Working in Safari https://elementor.com/help/troubleshooting-fixed-background-attachment-not-working-in-safari-iphone-ipad/
- bundlephobia — libheif-js https://bundlephobia.com/package/libheif-js
