// Applies the `theme` query parameter to `<html data-theme>` as early as
// possible, before the stylesheet and the rest of the page load.
//
// Why this file exists (see index.html/install.html, assets/app.js,
// tests/unit/theme-init*.test.js and tests/unit/agent-selector.test.js for
// where this rationale applies):
// - It must be the very first <script> in <head>, after the
//   Content-Security-Policy and referrer-policy meta tags (both only cover
//   content that follows them), but ahead of assets/style.css and
//   assets/app.js. Without it, the page renders with the default light
//   theme baked into the markup and only switches to the requested theme
//   once assets/app.js runs on `DOMContentLoaded` - after the stylesheet,
//   images and other scripts have loaded - causing a visible flash from
//   light to dark. Running this tiny, dependency-free script first
//   (blocking, synchronous, no defer/async) means the attribute is correct
//   before the browser paints anything.
// - The CSP forbids inline scripts, so this has to be a separate file
//   rather than an inline snippet in `<head>`.
// - Everything below runs inside an IIFE so its declarations stay private
//   to this file instead of leaking into the shared top-level scope that
//   classic <script> tags on the same page otherwise have in common.
//   assets/app.js reuses the theme constants and normalization logic
//   declared here through the explicit `window.ThemeInit` namespace
//   (browser) or this file's `module.exports` (Node/CommonJS), rather than
//   by reading bare identifiers left behind in the shared scope.
(function () {
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

  const themeInit = {
    DEFAULT_THEME,
    SUPPORTED_THEMES,
    normalizeTheme,
    applyInitialTheme,
  };

  // Both assignments run whenever their respective object exists (rather
  // than one being an `else` of the other), so `window.ThemeInit` is still
  // set in any environment that happens to define both `window` and
  // `module` (for example, the vm-based test harness in
  // tests/unit/agent-selector.test.js).
  if (typeof module !== "undefined" && module.exports) {
    module.exports = themeInit;
  }
  if (typeof window !== "undefined") {
    window.ThemeInit = themeInit;
  }
})();
