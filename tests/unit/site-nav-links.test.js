/**
 * @jest-environment jsdom
 */
const { updateSiteNavLinks, DEFAULT_THEME } = require("../../assets/app.js");

function renderNav(html) {
  document.body.innerHTML = `<nav>${html}</nav>`;
}

describe("updateSiteNavLinks", () => {
  test("removes the theme parameter for the default theme", () => {
    renderNav(
      '<a class="site-nav-link" href="index.html?theme=dark">Generate a badge</a>'
    );

    updateSiteNavLinks(DEFAULT_THEME);

    expect(document.querySelector(".site-nav-link").getAttribute("href")).toBe(
      "index.html"
    );
  });

  test("sets the theme parameter for a non-default theme", () => {
    renderNav('<a class="site-nav-link" href="index.html">Generate a badge</a>');

    updateSiteNavLinks("dark");

    expect(document.querySelector(".site-nav-link").getAttribute("href")).toBe(
      "index.html?theme=dark"
    );
  });

  test("preserves an existing relative path instead of making it root-relative", () => {
    renderNav(
      '<a class="site-nav-link" href="install.html">Install a plugin</a>'
    );

    updateSiteNavLinks("dark");

    expect(document.querySelector(".site-nav-link").getAttribute("href")).toBe(
      "install.html?theme=dark"
    );
  });

  test("preserves a hash fragment when adding the theme parameter", () => {
    renderNav(
      '<a class="site-nav-link" href="index.html#section">Generate a badge</a>'
    );

    updateSiteNavLinks("dark");

    expect(document.querySelector(".site-nav-link").getAttribute("href")).toBe(
      "index.html?theme=dark#section"
    );
  });

  test("preserves a hash fragment when removing the theme parameter", () => {
    renderNav(
      '<a class="site-nav-link" href="index.html?theme=dark#section">Generate a badge</a>'
    );

    updateSiteNavLinks(DEFAULT_THEME);

    expect(document.querySelector(".site-nav-link").getAttribute("href")).toBe(
      "index.html#section"
    );
  });

  test("leaves a fragment-only href untouched", () => {
    renderNav('<a class="site-nav-link" href="#section">Jump</a>');

    updateSiteNavLinks("dark");

    expect(document.querySelector(".site-nav-link").getAttribute("href")).toBe(
      "#section"
    );
  });

  test("leaves a query-only href untouched", () => {
    renderNav('<a class="site-nav-link" href="?foo=1">Jump</a>');

    updateSiteNavLinks("dark");

    expect(document.querySelector(".site-nav-link").getAttribute("href")).toBe(
      "?foo=1"
    );
  });

  test("ignores links without an href attribute", () => {
    renderNav('<a class="site-nav-link">No href</a>');

    expect(() => updateSiteNavLinks("dark")).not.toThrow();
    expect(document.querySelector(".site-nav-link").hasAttribute("href")).toBe(
      false
    );
  });
});
