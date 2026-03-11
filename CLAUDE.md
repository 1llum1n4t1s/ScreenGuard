# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Screen Shade is a Chrome Extension (Manifest V3) that covers page content with a resizable, draggable overlay. Supports 3 themes (Light/Dark/Glass blur), optional countdown timer for auto-hide, and persists overlay position/size/theme across sessions via `chrome.storage.local`. The extension is localized in Japanese.

## Build Commands

```bash
npm run build                # Generate icons + screenshots
npm run generate-icons       # SVG → PNG icons (16, 48, 128px) via sharp
npm run generate-screenshots # HTML templates → PNG store images via Puppeteer
```

No test framework is configured. No linter is configured.

## Architecture

Three components communicate via `chrome.runtime` message passing. Message action constants are defined in `scripts/actions.js` (shared by all three).

```
Popup (popup.html/js/css)
  ──SHOW_OVERLAY──▶  Background (scripts/background.js)
  ◀──GET_POPUP_STATE──  │
                         │ injects scripts/CSS into tab, then:
                         ──SHOW_OVERLAY_CS──▶  Content Script (scripts/content.js)
```

### Popup (`popup.html`, `popup.js`, `popup.css`)
User interface (260px wide). Theme selector (Light/Dark/Glass), timeout settings (minutes/seconds) with input validation. Sends `SHOW_OVERLAY` with `{isTimeoutEnabled, timeout, theme}` to background, then closes. Restores last-used theme from `chrome.storage.local`.

### Background (`scripts/background.js`)
Service worker. Stores timeout/theme state, injects `content.js` + `actions.js` + `css/content.css` into the active tab on first use (checks `window.__screenShadeRunning` to avoid re-injection), then sends `SHOW_OVERLAY_CS` with theme to the content script. Goes idle when not processing messages.

### Content Script (`scripts/content.js`)
IIFE-wrapped. Creates `#screenShadeOverlay` (z-index: 2147483647) with close button, timer label, 8 resize handles, and drag-to-move. Uses Pointer Events API for both resize and drag. Theme is applied via `data-theme` attribute. Timer runs locally via `setInterval` (1s). Overlay position/size/theme are saved to `chrome.storage.local` on resize/move end, and restored on next creation.

### Styling (`css/content.css`)
All rules use `!important` to override page styles. Overlay has fixed positioning with 15px inset margins. Resize handles: corner (16×16px) and edge (8px thickness). Close button uses CSS pseudo-elements for the × mark.

## Key Files

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 config; permissions: `activeTab`, `scripting` |
| `scripts/actions.js` | Frozen action constants shared across all scripts |
| `scripts/background.js` | Service worker: state, script injection |
| `scripts/content.js` | Overlay DOM creation, resize, timer |
| `popup.js` | Popup UI logic, timeout calculation |
| `css/content.css` | Overlay styles with `!important` overrides |
| `icons/icon.svg` | Source icon (512×512); PNGs generated to `images/` |
| `webstore-screenshots/*.html` | HTML templates rendered to `webstore-images/` by Puppeteer |

## Store Asset Generation

Icon SVG source at `icons/icon.svg` is converted to PNGs by `scripts/generate-icons.js` (sharp). Screenshot HTML templates in `webstore-screenshots/` are rendered to PNGs by `scripts/generate-screenshots.js` (Puppeteer) with exact viewport dimensions matching Chrome Web Store specs (1280×800, 440×280, 1400×560).
