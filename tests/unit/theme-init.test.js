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
