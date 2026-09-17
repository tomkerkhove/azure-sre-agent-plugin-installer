/**
 * @jest-environment jsdom
 */
const { applyTheme } = require("../../assets/app.js");

describe("applyTheme", () => {
  test("sets the requested theme on the document element", () => {
    expect(applyTheme("dark")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  test("falls back to the light theme for unsupported values", () => {
    expect(applyTheme("neon")).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  test("falls back to the light theme when no theme is provided", () => {
    expect(applyTheme(null)).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
