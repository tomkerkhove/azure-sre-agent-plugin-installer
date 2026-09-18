/** @jest-environment jsdom */

const { TextDecoder } = require("node:util");
const {
  sanitizeRepositoryReadmeHtml,
  loadRepositoryReadme,
  readResponseTextWithLimit,
  README_REQUEST_TIMEOUT_MS,
  README_MAX_LENGTH,
} = require("../../assets/app.js");

const originalFetch = global.fetch;
global.TextDecoder = TextDecoder;

afterEach(() => {
  global.fetch = originalFetch;
  window.sessionStorage.clear();
  jest.useRealTimers();
});

function sanitize(markup) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = sanitizeRepositoryReadmeHtml(
    markup,
    "tomkerkhove/azure-carbon-sre"
  );
  return wrapper;
}

describe("sanitizeRepositoryReadmeHtml", () => {
  test("preserves rendered markdown and secures its links", () => {
    const wrapper = sanitize(`
      <h1>Azure Carbon SRE</h1>
      <p>See the <a href="https://learn.microsoft.com/guide">guide</a>.</p>
      <table><tbody><tr><td colspan="2">Plugin</td></tr></tbody></table>
    `);

    expect(wrapper.querySelector("h1").textContent).toBe("Azure Carbon SRE");
    expect(wrapper.querySelector("a").outerHTML).toBe(
      '<a href="https://learn.microsoft.com/guide" target="_blank" rel="noopener noreferrer">guide</a>'
    );
    expect(wrapper.querySelector("td").getAttribute("colspan")).toBe("2");
  });

  test("removes active content and unsafe attributes", () => {
    const wrapper = sanitize(`
      <script>window.__xss = true</script>
      <form action="https://example.com"><input name="secret"></form>
      <p onclick="window.__xss = true">Safe text</p>
      <a href="javascript:alert(1)">Unsafe link</a>
      <img src="https://example.com/tracker.png" onerror="window.__xss = true">
    `);

    expect(wrapper.querySelector("script, form, input, img")).toBeNull();
    expect(wrapper.querySelector("p").attributes).toHaveLength(0);
    expect(wrapper.querySelector("a").hasAttribute("href")).toBe(false);
    expect(window.__xss).toBeUndefined();
  });

  test("removes images with empty sources", () => {
    const wrapper = sanitize(`
      <img alt="Missing source">
      <img src="  " alt="Empty source">
    `);

    expect(wrapper.querySelector("img")).toBeNull();
  });

  test("allows GitHub-hosted images without forwarding a referrer", () => {
    const wrapper = sanitize(`
      <img
        src="https://camo.githubusercontent.com/example"
        alt="Install badge"
        width="120"
        style="position: fixed"
      >
    `);
    const image = wrapper.querySelector("img");

    expect(image.getAttribute("src")).toBe(
      "https://camo.githubusercontent.com/example"
    );
    expect(image.getAttribute("alt")).toBe("Install badge");
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(image.getAttribute("style")).toBeNull();
  });

  test("resolves relative links and images against the repository", () => {
    const wrapper = sanitize(`
      <a href="CONTRIBUTING.md">Contribute</a>
      <img src="images/plugin.png" alt="Plugin">
    `);

    expect(wrapper.querySelector("a").getAttribute("href")).toBe(
      "https://github.com/tomkerkhove/azure-carbon-sre/blob/HEAD/CONTRIBUTING.md"
    );
    expect(wrapper.querySelector("img").getAttribute("src")).toBe(
      "https://github.com/tomkerkhove/azure-carbon-sre/raw/HEAD/images/plugin.png"
    );
  });
});

describe("loadRepositoryReadme", () => {
  test("reuses a rendered README during the browser session", async () => {
    document.body.innerHTML = `
      <p id="repository-readme-status">Loading README…</p>
      <div id="repository-readme-content" hidden></div>
    `;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({ content: "<h1>Azure Carbon SRE</h1>" })
      ),
    });

    await loadRepositoryReadme("tomkerkhove/azure-carbon-sre");
    document.body.innerHTML = `
      <p id="repository-readme-status">Loading README…</p>
      <div id="repository-readme-content" hidden></div>
    `;
    await loadRepositoryReadme("tomkerkhove/azure-carbon-sre");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector("#repository-readme-content h1").textContent
    ).toBe("Azure Carbon SRE");
    expect(document.getElementById("repository-readme-status").hidden).toBe(
      true
    );
  });

  test("renders a README returned directly as HTML", async () => {
    document.body.innerHTML = `
      <p id="repository-readme-status">Loading README…</p>
      <div id="repository-readme-content" hidden></div>
    `;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue("<h1>Azure Carbon SRE</h1>"),
    });

    await loadRepositoryReadme("tomkerkhove/azure-carbon-sre");

    expect(
      document.querySelector("#repository-readme-content h1").textContent
    ).toBe("Azure Carbon SRE");
    expect(document.getElementById("repository-readme-content").hidden).toBe(
      false
    );
    expect(document.getElementById("repository-readme-status").hidden).toBe(
      true
    );
  });

  test("treats JSON primitives as direct README markup", async () => {
    document.body.innerHTML = `
      <p id="repository-readme-status">Loading README…</p>
      <div id="repository-readme-content" hidden></div>
    `;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue('"Azure Carbon SRE"'),
    });

    await loadRepositoryReadme("tomkerkhove/azure-carbon-sre");

    expect(document.getElementById("repository-readme-content").textContent).toBe(
      '"Azure Carbon SRE"'
    );
    expect(document.getElementById("repository-readme-content").hidden).toBe(
      false
    );
  });

  test("shows the fallback when the GitHub request times out", async () => {
    jest.useFakeTimers();
    document.body.innerHTML = `
      <p id="repository-readme-status">Loading README…</p>
      <div id="repository-readme-content" hidden></div>
    `;
    global.fetch = jest.fn((_url, options) => {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });

    });

    const loading = loadRepositoryReadme("tomkerkhove/azure-carbon-sre");
    jest.advanceTimersByTime(README_REQUEST_TIMEOUT_MS);
    await loading;

    expect(document.getElementById("repository-readme-status").textContent).toBe(
      "The README preview is unavailable. View it on GitHub instead."
    );
    expect(document.getElementById("repository-readme-content").hidden).toBe(
      true
    );
  });
});

describe("readResponseTextWithLimit", () => {
  test("rejects a declared oversized README before reading it", async () => {
    const response = {
      headers: {
        get: jest.fn().mockReturnValue(String(README_MAX_LENGTH + 1)),
      },
      text: jest.fn(),
    };

    await expect(
      readResponseTextWithLimit(response, README_MAX_LENGTH)
    ).rejects.toThrow("README is too large");
    expect(response.text).not.toHaveBeenCalled();
  });

  test("cancels a streamed README when it exceeds the limit", async () => {
    const reader = {
      read: jest.fn().mockResolvedValue({
        done: false,
        value: new Uint8Array(README_MAX_LENGTH + 1),
      }),
      cancel: jest.fn().mockResolvedValue(),
      releaseLock: jest.fn(),
    };
    const response = {
      headers: { get: jest.fn().mockReturnValue(null) },
      body: { getReader: jest.fn().mockReturnValue(reader) },
    };

    await expect(
      readResponseTextWithLimit(response, README_MAX_LENGTH)
    ).rejects.toThrow("README is too large");
    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });
});
