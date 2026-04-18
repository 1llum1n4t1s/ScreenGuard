/** @readonly メッセージアクション定義 */
const Actions = Object.freeze({
  SHOW_OVERLAY: "showOverlay",
  SHOW_OVERLAY_CS: "showOverlayCS",
  RESET_PREFS: "resetPrefs",
  UPDATE_BLUR: "updateBlur",
});

/** @readonly テーマ名定義 */
const Themes = Object.freeze({
  LIGHT: "light",
  DARK: "dark",
  GLASS: "glass",
});

/** @readonly 許可テーマ allowlist（外部メッセージ検証用） */
const THEME_ALLOWLIST = Object.freeze(new Set(Object.values(Themes)));

/** @readonly ぼかし設定 */
const BlurConfig = Object.freeze({
  DEFAULT: 5,
  MIN: 1,
  MAX: 20,
});

/** @readonly 寸法・レイアウト定数（content.js と popup.js で共有） */
const Dimensions = Object.freeze({
  DEFAULT_SIZE: 300,       // リセット・初期表示時のサイズ
  DEFAULT_MARGIN: 15,      // 中央配置時の最小マージン
  MIN_SIZE: 40,            // リサイズの最小値
  VISIBLE_THRESHOLD: 100,  // 画面外判定の最低表示量
});

/** @readonly ストレージキー */
const StorageKeys = Object.freeze({
  PREFS: "shadePrefs",
  GLASS_BLUR: "glassBlur",
});

/** blur 値を有効範囲に収める */
function clampBlur(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return BlurConfig.DEFAULT;
  return Math.max(BlurConfig.MIN, Math.min(BlurConfig.MAX, Math.round(n)));
}

/** テーマ文字列を allowlist で検証、不正値は LIGHT にフォールバック */
function sanitizeTheme(v) {
  return THEME_ALLOWLIST.has(v) ? v : Themes.LIGHT;
}
