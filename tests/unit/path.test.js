const { normalizePath } = require("../../assets/app.js");

describe("normalizePath", () => {
  test("returns an empty string for missing input", () => {
    expect(normalizePath(undefined)).toBe("");
    expect(normalizePath(null)).toBe("");
    expect(normalizePath("")).toBe("");
    expect(normalizePath("   ")).toBe("");
  });

  test("accepts a simple path", () => {
    expect(normalizePath("plugins/my-plugin")).toBe("plugins/my-plugin");
  });

  test("trims surrounding whitespace", () => {
    expect(normalizePath("  plugins/my-plugin  ")).toBe("plugins/my-plugin");
  });

  test("strips leading and trailing slashes", () => {
    expect(normalizePath("/plugins/my-plugin/")).toBe("plugins/my-plugin");
  });

  test("accepts dots, dashes and underscores", () => {
    expect(normalizePath("src/my_plugin.v2/dir-name")).toBe(
      "src/my_plugin.v2/dir-name"
    );
  });

  test("rejects path traversal", () => {
    expect(normalizePath("../../etc/passwd")).toBe("");
    expect(normalizePath("plugins/../../secret")).toBe("");
  });

  test("rejects markup and script characters", () => {
    expect(normalizePath("<img src=x onerror=alert(1)>")).toBe("");
    expect(normalizePath('plugins/"onmouseover="alert(1)')).toBe("");
    expect(normalizePath("plugins/my plugin")).toBe("");
  });

  test("rejects excessively long paths", () => {
    expect(normalizePath("a".repeat(201))).toBe("");
    expect(normalizePath("a".repeat(200))).toBe("a".repeat(200));
  });
});
