# よていくん デザインルール

## カラー

| 変数 | 値 | 用途 |
|---|---|---|
| `--black` | `#1a1a1a` | テキスト（基本）、ボタン背景、テーブルヘッダー |
| `--k80` | `#333333` | セクション見出し（h2）、強調テキスト |
| `--k60` | `#666666` | 本文テキスト、サブテキスト |
| `--k40` | `#999999` | プレースホルダー、注釈、フッターコピー |
| `--k20` | `#cccccc` | セパレーター記号 |
| `--k10` | `#e4e4e4` | ボーダー（カード、セパレーター） |
| `--white` | `#ffffff` | 背景、ボタンテキスト（黒背景時） |
| `--ok` | `#2d7a4f` | アクセント緑（リンクホバー） |
| `--ok-light` | `#e8f5ee` | よていくん列の背景（比較表） |
| `--amber` | `#c47c1a` | アンバー（ヒートマップ参照色） |
| `--amber-light` | `#fef3e2` | アンバー背景 |

**絵文字・カラーアイコンは使用しない。**


## タイポグラフィ

- **フォント**：Noto Sans JP → Yu Gothic → YuGothic（sans-serif fallback）
- **基準サイズ**：ブラウザデフォルト（16px）に対して `rem` で指定

| 用途 | サイズ | ウェイト |
|---|---|---|
| ヒーロータイトル（h1） | 1.7rem（SP: 1.3rem） | 900 |
| セクション見出し（h2 / `.section-h2`） | 1.1rem | 700 |
| カードタイトル、FAQタイトル | 0.85〜0.92rem | 700 |
| 本文（`.section-body`、`.feature-text` など） | 0.78〜0.86rem | 400 |
| 注釈、フッター | 0.62〜0.72rem | 400 |

- **行間**：本文 `1.75〜1.95`、FAQアンサー `1.9`
- **letter-spacing**：h1・h2は `-0.01em`、ロゴは `0.04em`


## スペーシング

- **角丸**：`--r: 4px`（全コンポーネント共通）
- **コンテンツ幅**：`max-width: 680px`、中央揃え
- **mainパディング**：`48px 20px 80px`（SP: `28px 16px 60px`）
- **セクション間**：`margin-bottom: 48px`、`<hr class="sep">` で区切り（`margin: 48px 0`）
- **カードパディング**：`16〜20px`


## コンポーネント

### ヘッダー
- 上部固定（`position: sticky; top: 0; z-index: 100`）
- 左：ロゴ（アイコン32px + テキスト）
- 右：CTAボタン（黒背景・白テキスト）

### CTAボタン
```
background: var(--black)
color: var(--white)
border-radius: var(--r)
font-weight: 700
padding: 9px 18px（ヘッダー）/ 15px 40px（ヒーロー）/ 14px 40px（フッターCTA）
```
- ホバー時：`var(--k80)`に変化
- 反転パターン（黒背景上）：`background: white; color: black`

### カード
```
border: 1px solid var(--k10)
border-radius: var(--r)
padding: 16〜20px
```
- 影なし、フラットなデザイン

### 比較表
- ヘッダー行：`var(--black)` 背景・白テキスト
- よていくん列：`background: #1a3a2a`（ヘッダー）、`var(--ok-light)`（ボディ）
- 偶数行：`#fafafa`
- ○／× の表記を使う（絵文字の ✅❌ は使用しない）

### マーカーハイライト
```css
mark {
  background: linear-gradient(transparent 55%, #fde68a 55%);
  color: inherit;
  padding: 0 1px;
}
```
- 黄色（`#fde68a`）で下半分にグラデーション
- 各ページで**1〜2か所**の核心フレーズに絞って使用する
- 多用しない

### FAQ（アコーディオン）
- `<details>` + `<summary>` を使用
- 開閉インジケーター：`＋` / `－`（CSS `::after` で制御）

### ステップ番号（howto）
```
width: 26px; height: 26px
background: var(--black)
color: var(--white)
border-radius: 50%
font-size: 0.72rem; font-weight: 700
```

### サイトフッターナビ（全ページ共通）
- 全ページ下部に配置
- リンク一覧：ホーム・よていくんとは・日程調整ツール・使い方ガイド・調整さんの代替・プライバシーポリシー
- セパレーター：`·`

```html
<footer class="site-footer">
  <nav class="site-footer-nav">
    <a href="/" class="sfn-link">ホーム</a>
    <span class="sfn-sep">·</span>
    <a href="/about" class="sfn-link">よていくんとは</a>
    <span class="sfn-sep">·</span>
    <a href="/schedule-adjustment-tool" class="sfn-link">日程調整ツール</a>
    <span class="sfn-sep">·</span>
    <a href="/guide/how-to-schedule" class="sfn-link">使い方ガイド</a>
    <span class="sfn-sep">·</span>
    <a href="/chouseisan-alternative" class="sfn-link">調整さんの代替</a>
    <span class="sfn-sep">·</span>
    <a href="/privacy" class="sfn-link">プライバシーポリシー</a>
  </nav>
  <div class="site-footer-copy">© 2026 よていくん</div>
</footer>
```


## CSSファイル構成

| ファイル | 役割 |
|---|---|
| `style.css` | index.html（メインアプリ）のスタイル |
| `about.css` | LPページ共通スタイル。全LPページで読み込む |
| `chouseisan-alternative.css` | `/chouseisan-alternative` 固有スタイル |
| `schedule-adjustment-tool.css` | `/schedule-adjustment-tool` 固有スタイル |
| `guide/how-to-schedule.css` | `/guide/how-to-schedule` 固有スタイル |
| `privacy.css` | `/privacy` 固有スタイル |

**新しいLPページを追加する場合は `about.css` を必ず読み込むこと。**


## URL設計

- `.html` 拡張子なしのクリーンURL（`firebase.json` の `rewrites` で対応）
- canonical / OGP / JSON-LD / sitemap.xml もクリーンURLで統一

```
/          → index.html
/about     → about.html
/privacy   → privacy.html
/schedule-adjustment-tool  → schedule-adjustment-tool.html
/chouseisan-alternative    → chouseisan-alternative.html
/guide/how-to-schedule     → guide/how-to-schedule.html
```


## ライティングルール

- 絵文字は使用しない（UI・見出し・本文すべて）
- ✅❌⚠️ などの記号アイコンも使用しない（比較表は ○ / × / 文字）
- 数字バッジ・番号カード（① ② など）は使用しない
- 「選ばれる理由」「〜が最強」などの過度な営業表現は避ける
- 事実ベースの簡潔な文章にする
- 見出しは `section-h2`（1.1rem / font-weight 700）を使う（`section-label` の小さい大文字は使わない）


## GA4

- 測定ID：`G-MZW4ZD5QBE`
- プロジェクト：`yotei-kun-6f3c9`
- 全ページの `<head>` に計測タグを設置する
