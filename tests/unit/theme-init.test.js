/**
 * @jest-environment jsdom
 */
const {
  DEFAULT_THEME,
  SUPPORTED_THEMES,
  normalizeTheme,
  applyInitialTheme,
} = require("../../assets/theme-init.js");

describe("theme-init normalizeTheme", () => {
  test("defaults to light for missing or invalid values", () => {
    expect(normalizeTheme(undefined)).toBe(DEFAULT_THEME);
    expect(normalizeTheme(null)).toBe(DEFAULT_THEME);
    expect(normalizeTheme("neon")).toBe(DEFAULT_THEME);
  });

  test("accepts supported themes case-insensitively", () => {
    expect(normalizeTheme("dark")).toBe("dark");
    expect(normalizeTheme("  DARK ")).toBe("dark");
  });

  test("only supports the documented themes", () => {
    expect(SUPPORTED_THEMES).toEqual(["light", "dark"]);
  });
});

describe("applyInitialTheme", () => {
  test("sets data-theme from the `theme` query parameter before anything else runs", () => {
    expect(applyInitialTheme("?theme=dark")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  test("falls back to the light theme when the query parameter is absent", () => {
    expect(applyInitialTheme("")).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  test("falls back to the light theme for an unsupported value", () => {
    expect(applyInitialTheme("?theme=neon")).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});

describe("module load side effect", () => {
  test("applies the theme from window.location.search as soon as the module loads, without waiting for a function call", () => {
    // Regression test for the flash: theme-init.js must apply the theme as
    // an immediate side effect of loading, not only when some other code
    // later calls applyInitialTheme(). Navigating via pushState (rather
    // than reassigning window.location) lets jsdom update
    // window.location.search without reloading the page or the module
    // registry, then a fresh require() re-runs theme-init.js's top-level
    // code against that URL.
    window.history.pushState(null, "", "/install.html?theme=dark");
    document.documentElement.removeAttribute("data-theme");

    jest.resetModules();
    require("../../assets/theme-init.js");

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
