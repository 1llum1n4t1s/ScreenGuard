// 撮影前操作（vitrina の steps）。
// ページ上のオーバーレイは、実際の流れと同じく「拡張ページ → background の SHOW_OVERLAY →
// scripting.executeScript で content script を注入 → オーバーレイ表示」で出す。
// headless では activeTab が付かないため、撮影用コピー（prepare-capture-extension.mjs）に
// 固定ページのホスト権限を足してある。テーマ・位置・ぼかしは capture の storage（shadePrefs / glassBlur）が持つ。

/** 固定ページのタブへ SHOW_OVERLAY を送り、オーバーレイが出るまで待つ。 */
async function showOverlay({ page, session, cap }) {
  const prefs = cap.storage?.shadePrefs ?? {};
  const blur = cap.storage?.glassBlur ?? 5;
  const sender = await session.browser.newPage();
  try {
    await sender.goto(`chrome-extension://${session.extensionId}/src/popup/popup.html`, { waitUntil: "load" });
    const origin = new URL(cap.url).origin;
    const res = await sender.evaluate(async (origin, theme, glassBlur) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t) => t.url && t.url.startsWith(origin));
      if (!tab) return { ok: false, error: "固定ページのタブが見つかりません" };
      return chrome.runtime.sendMessage({ action: "showOverlay", tabId: tab.id, data: { theme, glassBlur } });
    }, origin, prefs.theme, blur);
    if (!res?.ok) throw new Error(`オーバーレイを出せませんでした: ${res?.error ?? "応答なし"}`);
  } finally {
    await sender.close().catch(() => {});
  }
  await page.bringToFront();
  // closed shadow root 内は DOM から見えないため、host の存在で待つ
  await page.waitForSelector("#screenShadeHost", { timeout: 15000 });
  // 閉じる（×）ボタンはマウスが乗ったときだけ出る設計なので、オーバーレイ中央へ乗せて実UIのまま見せる
  if (Number.isFinite(prefs.left)) await page.mouse.move(prefs.left + prefs.width / 2, prefs.top + prefs.height / 2);
}

/**
 * popup の <html lang> は localStorage の控え（cpaUiLanguage）から同期で決まり、言語別フォントの選択に使われる。
 * 実利用では言語を選んだ時点で控えが残る。撮影では chrome.storage だけを書いて毎回新しい言語で最初に開くため、
 * 控えが前の言語のままになる（撮影方式由来で、拡張側の不具合ではない）。控えを入れて開き直した状態を撮る。
 */
async function reloadWithLanguage({ page, locale, cap }) {
  await page.evaluate((code) => localStorage.setItem("cpaUiLanguage", code), locale);
  await page.reload({ waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((resolve) => setTimeout(resolve, 600));
  const size = await page.evaluate(() => {
    const r = document.body.getBoundingClientRect();
    return { w: Math.ceil(r.width), h: Math.ceil(Math.max(document.body.scrollHeight, r.height)) };
  });
  await page.setViewport({ width: size.w, height: Math.min(size.h, cap.maxHeight ?? 600), deviceScaleFactor: cap.scale ?? 2 });
}

export default {
  "popup-glass": reloadWithLanguage,
  "page-dark": showOverlay,
  "page-glass": showOverlay,
  "page-light": showOverlay,
};
