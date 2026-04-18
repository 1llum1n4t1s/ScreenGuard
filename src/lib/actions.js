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

/** @readonly ぼかし設定 */
const BlurConfig = Object.freeze({
  DEFAULT: 5,
  MIN: 1,
  MAX: 20,
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
