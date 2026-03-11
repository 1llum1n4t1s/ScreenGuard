# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Screen Shade is a Chrome Extension (Manifest V3) that covers page content with a resizable, draggable overlay. Supports 3 themes (Light/Dark/Glass blur) and persists overlay position/size/theme across sessions via `chrome.storage.local`. The extension is localized in Japanese.

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
                       │ injects scripts/CSS into tab, then:
                       ──SHOW_OVERLAY_CS──▶  Content Script (scripts/content.js)
  ──RESET_PREFS──▶   Background ──forward──▶  Content Script
```

### Popup (`popup.html`, `popup.js`, `popup.css`)
User interface (260px wide). Theme selector (Light/Dark/Glass) and reset button for position/size. Sends `SHOW_OVERLAY` with `{theme}` to background, then closes. Restores last-used theme from `chrome.storage.local`.

### Background (`scripts/background.js`)
Service worker. Stores theme state, injects `content.js` + `actions.js` + `css/content.css` into the active tab on first use (checks `window.__screenShadeRunning` to avoid re-injection), then sends `SHOW_OVERLAY_CS` with theme to the content script. Forwards `RESET_PREFS` to active tab. Skips injection on `chrome://`, `edge://`, `about:` pages.

### Content Script (`scripts/content.js`)
IIFE-wrapped. Creates `#screenShadeOverlay` (z-index: 2147483647) with close button, 8 resize handles, and drag-to-move. Uses Pointer Events API with `setPointerCapture` for both resize and drag. Theme is applied via `data-theme` attribute. Overlay position/size are saved to `chrome.storage.local` on resize/move end, and restored on next creation. Theme always comes from popup selection (not storage).

### Styling (`css/content.css`)
All rules use `!important` to override page styles. Overlay uses explicit `top/left/width/height` positioning (no `bottom/right`). Resize handles: corner (16×16px) and edge (8px thickness). Close button uses CSS pseudo-elements for the × mark.

## Key Files

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 config; permissions: `activeTab`, `scripting`, `storage` |
| `scripts/actions.js` | Frozen action constants shared across all scripts |
| `scripts/background.js` | Service worker: state, script injection, message forwarding |
| `scripts/content.js` | Overlay DOM creation, resize, drag, persistence |
| `popup.js` | Popup UI logic, theme selection, reset |
| `css/content.css` | Overlay styles with `!important` overrides |
| `icons/icon.svg` | Source icon (512×512); PNGs generated to `images/` |
| `webstore-screenshots/*.html` | HTML templates rendered to `webstore-images/` by Puppeteer |

## Store Asset Generation

Icon SVG source at `icons/icon.svg` is converted to PNGs by `scripts/generate-icons.js` (sharp). Screenshot HTML templates in `webstore-screenshots/` are rendered to PNGs by `scripts/generate-screenshots.js` (Puppeteer) with exact viewport dimensions matching Chrome Web Store specs (1280×800, 440×280, 1400×560).
