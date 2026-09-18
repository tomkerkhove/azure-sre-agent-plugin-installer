const { getInstallPageUrl } = require("../../assets/install-page.js");

describe("getInstallPageUrl", () => {
  test("resolves install.html alongside the landing page", () => {
    expect(getInstallPageUrl("https://example.com/")).toBe(
      "https://example.com/install.html"
    );
  });

  test("resolves relative to a subpath deployment", () => {
    expect(
      getInstallPageUrl("https://example.com/azure-sre-agent-plugin-installer/")
    ).toBe("https://example.com/azure-sre-agent-plugin-installer/install.html");
  });

  test("ignores the current page's own query string", () => {
    expect(getInstallPageUrl("https://example.com/?theme=dark")).toBe(
      "https://example.com/install.html"
    );
  });
});
