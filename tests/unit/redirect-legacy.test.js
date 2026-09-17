const { buildInstallPageRedirectUrl } = require("../../assets/redirect-legacy.js");

describe("buildInstallPageRedirectUrl", () => {
  test("points at install.html alongside the landing page", () => {
    const url = buildInstallPageRedirectUrl("https://example.com/?repo=owner%2Frepo");
    expect(url).toBe("https://example.com/install.html?repo=owner%2Frepo");
  });

  test("preserves the theme and path query parameters", () => {
    const url = buildInstallPageRedirectUrl(
      "https://example.com/?repo=owner%2Frepo&path=plugins%2Fmy-plugin&theme=dark"
    );
    expect(url).toBe(
      "https://example.com/install.html?repo=owner%2Frepo&path=plugins%2Fmy-plugin&theme=dark"
    );
  });

  test("resolves relative to a subpath deployment", () => {
    const url = buildInstallPageRedirectUrl(
      "https://example.com/azure-sre-agent-plugin-installer/?repo=owner%2Frepo"
    );
    expect(url).toBe(
      "https://example.com/azure-sre-agent-plugin-installer/install.html?repo=owner%2Frepo"
    );
  });

  test("drops any query parameters when there are none to preserve", () => {
    const url = buildInstallPageRedirectUrl("https://example.com/");
    expect(url).toBe("https://example.com/install.html");
  });
});
