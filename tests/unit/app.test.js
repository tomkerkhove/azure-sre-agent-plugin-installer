const {
  normalizeRepo,
  normalizeTheme,
  buildInstallerUrl,
  buildBadgeMarkdown,
} = require("../../assets/app.js");

describe("normalizeRepo", () => {
  test("returns null for empty/undefined input", () => {
    expect(normalizeRepo(undefined)).toBeNull();
    expect(normalizeRepo(null)).toBeNull();
    expect(normalizeRepo("")).toBeNull();
  });

  test("accepts an owner/repo shorthand", () => {
    expect(normalizeRepo("owner/repo")).toBe("owner/repo");
  });

  test("trims surrounding whitespace", () => {
    expect(normalizeRepo("  owner/repo  ")).toBe("owner/repo");
  });

  test("reduces a full GitHub URL to owner/repo", () => {
    expect(normalizeRepo("https://github.com/owner/repo")).toBe("owner/repo");
  });

  test("reduces a full GitHub URL with trailing slash", () => {
    expect(normalizeRepo("https://github.com/owner/repo/")).toBe("owner/repo");
  });

  test("reduces a full GitHub URL with .git suffix", () => {
    expect(normalizeRepo("https://github.com/owner/repo.git")).toBe("owner/repo");
  });

  test("accepts www.github.com URLs", () => {
    expect(normalizeRepo("https://www.github.com/owner/repo")).toBe("owner/repo");
  });

  test("rejects invalid shapes", () => {
    expect(normalizeRepo("not-a-repo")).toBeNull();
    expect(normalizeRepo("owner/repo/extra")).toBeNull();
    expect(normalizeRepo("https://example.com/owner/repo")).toBeNull();
  });
});

describe("buildInstallerUrl", () => {
  test("sets the repo query parameter", () => {
    const url = buildInstallerUrl("https://example.com/", "owner/repo");
    expect(url).toBe("https://example.com/?repo=owner%2Frepo");
  });

  test("includes the path query parameter when provided", () => {
    const url = buildInstallerUrl("https://example.com/", "owner/repo", "plugins/my-plugin");
    expect(url).toBe("https://example.com/?repo=owner%2Frepo&path=plugins%2Fmy-plugin");
  });

  test("omits the path query parameter when not provided", () => {
    const url = buildInstallerUrl("https://example.com/", "owner/repo", "");
    expect(url).toBe("https://example.com/?repo=owner%2Frepo");
  });

  test("includes the theme query parameter for the dark theme", () => {
    const url = buildInstallerUrl("https://example.com/", "owner/repo", "", "dark");
    expect(url).toBe("https://example.com/?repo=owner%2Frepo&theme=dark");
  });

  test("omits the theme query parameter for the default light theme", () => {
    expect(buildInstallerUrl("https://example.com/", "owner/repo", "", "light")).toBe(
      "https://example.com/?repo=owner%2Frepo"
    );
    expect(buildInstallerUrl("https://example.com/", "owner/repo")).toBe(
      "https://example.com/?repo=owner%2Frepo"
    );
  });

  test("omits the theme query parameter for an unsupported theme", () => {
    const url = buildInstallerUrl("https://example.com/", "owner/repo", "", "neon");
    expect(url).toBe("https://example.com/?repo=owner%2Frepo");
  });
});

describe("normalizeTheme", () => {
  test("defaults to the light theme", () => {
    expect(normalizeTheme(undefined)).toBe("light");
    expect(normalizeTheme(null)).toBe("light");
    expect(normalizeTheme("")).toBe("light");
  });

  test("accepts the supported themes", () => {
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme("dark")).toBe("dark");
  });

  test("is case-insensitive and trims whitespace", () => {
    expect(normalizeTheme("  DARK ")).toBe("dark");
  });

  test("falls back to light for unsupported values", () => {
    expect(normalizeTheme("neon")).toBe("light");
    expect(normalizeTheme(42)).toBe("light");
  });
});

describe("buildBadgeMarkdown", () => {
  test("wraps the installer URL in badge markdown", () => {
    const markdown = buildBadgeMarkdown("https://example.com/?repo=owner%2Frepo");
    expect(markdown).toContain("[![Install to Azure SRE Agent]");
    expect(markdown).toContain("(https://example.com/?repo=owner%2Frepo)");
  });
});
