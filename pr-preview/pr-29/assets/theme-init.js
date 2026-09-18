// Applies the `theme` query parameter to `<html data-theme>` as early as
// possible, before the stylesheet and the rest of the page load.
//
// This must be the very first <script> in <head>, ahead of
// assets/style.css and assets/app.js: without it, the page renders with the
// default light theme baked into index.html/install.html's markup, and only
// switches to the requested theme once assets/app.js runs on
// `DOMContentLoaded` - after the stylesheet, images and other scripts have
// loaded - causing a visible flash from light to dark. Running this tiny,
// dependency-free script first (blocking, synchronous, no defer/async)
// means the attribute is correct before the browser paints anything.
//
// The Content-Security-Policy forbids inline scripts, so this has to be a
// separate file rather than an inline snippet in the `<head>`.
//
// Shared with assets/app.js (all classic <script> tags share one top-level
// scope), which declares the theme toggle and badge/link generation on top
// of the same theme constants and normalization logic.
const DEFAULT_THEME = "light";
const SUPPORTED_THEMES = ["light", "dark"];

function normalizeTheme(rawTheme) {
  if (typeof rawTheme !== "string") return DEFAULT_THEME;

  const theme = rawTheme.trim().toLowerCase();
  return SUPPORTED_THEMES.includes(theme) ? theme : DEFAULT_THEME;
}

function applyInitialTheme(search) {
  const theme = normalizeTheme(new URLSearchParams(search).get("theme"));
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.setAttribute("data-theme", theme);
  }
  return theme;
}

if (typeof window !== "undefined" && typeof window.location !== "undefined") {
  applyInitialTheme(window.location.search);
}

// Export the pure functions for unit testing (Node/CommonJS) while keeping
// the browser bundle dependency-free: in the browser this file is loaded via
// a plain <script> tag, so these become globals that assets/app.js can call
// directly. In Node, assets/app.js requires this file for its side effect of
// attaching them to `global`, so it can call them the same way without
// duplicating the theme constants and normalization logic.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_THEME,
    SUPPORTED_THEMES,
    normalizeTheme,
    applyInitialTheme,
  };
  if (typeof global !== "undefined") {
    global.DEFAULT_THEME = DEFAULT_THEME;
    global.SUPPORTED_THEMES = SUPPORTED_THEMES;
    global.normalizeTheme = normalizeTheme;
    global.applyInitialTheme = applyInitialTheme;
  }
}
