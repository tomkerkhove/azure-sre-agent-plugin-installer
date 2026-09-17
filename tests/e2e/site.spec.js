const { test, expect } = require("@playwright/test");

test.describe("Install to Azure SRE Agent site", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("https://api.github.com/**", async (route) => {
      await route.fulfill({ status: 404, body: "{}" });
    });
  });

  test("shows the empty state when no repo is specified", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("#empty-state")).toBeVisible();
    await expect(page.locator("#install-card")).toBeHidden();
    await expect(page.locator("h1")).toHaveText("Install to Azure SRE Agent");
  });

  test("loads the bundled MSAL browser library", async ({ page }) => {
    const msalResponse = page.waitForResponse((response) =>
      response.url().endsWith("/assets/vendor/msal-browser.min.js")
    );

    await page.goto("/");

    expect((await msalResponse).status()).toBe(200);
    expect(
      await page.evaluate(() => typeof window.msal?.PublicClientApplication === "function")
    ).toBe(true);
  });

  test("renders the install card when a repo query parameter is provided", async ({ page }) => {
    await page.goto("/?repo=owner/repo");

    const installCard = page.locator("#install-card");
    await expect(installCard).toBeVisible();
    await expect(page.locator("#empty-state")).toBeHidden();
    await expect(installCard.locator("h2 span")).toHaveText("owner/repo");
    await expect(installCard.locator("a", { hasText: "https://github.com/owner/repo" })).toHaveAttribute(
      "href",
      "https://github.com/owner/repo"
    );
    await expect(installCard.locator("#repo-value")).toHaveValue("owner/repo");
  });

  test("shows the fallback options when online installation is not configured", async ({ page }) => {
    await page.goto("/?repo=owner/repo");

    await expect(page.locator("#sign-in-btn")).toBeDisabled();
    await expect(page.locator("#online-status")).toContainText(
      "Online installation isn't configured yet"
    );
    await expect(page.locator("#alternative-options")).toHaveAttribute("open", "");
    await expect(page.locator("#api-import-form")).toBeVisible();
    await expect(page.locator("#alternative-options h3")).toHaveText([
      "Install in the Azure portal",
      "Generate an Azure CLI command",
    ]);
  });

  test("shows the path in repository when the path query parameter is provided", async ({ page }) => {
    await page.goto("/?repo=owner/repo&path=plugins/my-plugin");

    const installCard = page.locator("#install-card");
    await expect(installCard.locator("dt", { hasText: "Path in repository" })).toBeVisible();
    await expect(installCard.locator("dd code")).toHaveText("plugins/my-plugin");
  });

  test("renders the repository README in the install card", async ({ page }) => {
    let readmeRequests = 0;
    await page.route(
      "https://github.com/tomkerkhove/azure-carbon-sre/raw/HEAD/images/plugin.png",
      async (route) => {
        await route.fulfill({ status: 204 });
      }
    );
    await page.route(
      "https://api.github.com/repos/tomkerkhove/azure-carbon-sre/readme",
      async (route) => {
        readmeRequests += 1;
        expect(route.request().headers().accept).toBe(
          "application/vnd.github.html+json"
        );
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: `
            <h1>Azure Carbon SRE</h1>
            <p>An Azure SRE Agent plugin marketplace.</p>
            <h2>Included plugin</h2>
            <table><tbody><tr><td><code>azure-carbon-sre</code></td></tr></tbody></table>
            <img src="images/plugin.png" alt="Plugin diagram">
          `,
        });
      }
    );

    await page.goto("/?repo=tomkerkhove/azure-carbon-sre");

    const readme = page.locator("#repository-readme-content");
    await expect(page.locator("#repository-readme-heading")).toHaveText(
      "Repository README"
    );
    await expect(readme).toBeVisible();
    await expect(readme.locator("h1")).toHaveText("Azure Carbon SRE");
    await expect(readme.locator("table code")).toHaveText("azure-carbon-sre");
    await expect(readme.locator("img")).toHaveAttribute(
      "src",
      "https://github.com/tomkerkhove/azure-carbon-sre/raw/HEAD/images/plugin.png"
    );
    await expect(readme).toHaveAttribute("role", "region");
    await expect(readme).toHaveAttribute(
      "aria-labelledby",
      "repository-readme-heading"
    );
    await expect(readme).toHaveAttribute("tabindex", "0");
    await expect(page.locator("#repository-readme-status")).toBeHidden();

    await page.reload();

    await expect(page.locator("#repository-readme-content h1")).toHaveText(
      "Azure Carbon SRE"
    );
    expect(readmeRequests).toBe(1);
  });

  test("keeps the GitHub fallback when the README cannot be loaded", async ({ page }) => {
    await page.goto("/?repo=owner/missing-readme");

    await expect(page.locator("#repository-readme-status")).toHaveText(
      "The README preview is unavailable. View it on GitHub instead."
    );
    await expect(page.locator("#repository-readme-content")).toBeHidden();
    await expect(
      page.locator(".repository-readme a", { hasText: "View on GitHub" })
    ).toHaveAttribute("href", "https://github.com/owner/missing-readme");
  });

  test("normalizes a full GitHub URL passed as the repo parameter", async ({ page }) => {
    await page.goto("/?repo=https://github.com/owner/repo");

    await expect(page.locator("#install-card h2 span")).toHaveText("owner/repo");
  });

  test("shows the empty state for an invalid repo parameter", async ({ page }) => {
    await page.goto("/?repo=not-a-valid-repo");

    await expect(page.locator("#empty-state")).toBeVisible();
    await expect(page.locator("#install-card")).toBeHidden();
  });

  test("copies the repository to the clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/?repo=owner/repo");

    await page.locator("#copy-repo-btn").click();

    await expect(page.locator("#toast")).toHaveClass(/visible/);
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe("owner/repo");
  });

  test("generates badge markdown from the generator form", async ({ page }) => {
    await page.goto("/");

    await page.locator("#gen-repo").fill("owner/repo");
    await page.locator("#gen-path").fill("plugins/my-plugin");
    await page.locator("#generator-form button[type=submit]").click();

    const output = page.locator("#generator-output");
    await expect(output).toBeVisible();
    await expect(output).toContainText("[![Install to Azure SRE Agent]");
    await expect(output).toContainText("repo=owner%2Frepo");
    await expect(output).toContainText("path=plugins%2Fmy-plugin");
  });

  test("uses the light theme by default", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("uses the dark theme when the theme query parameter is dark", async ({ page }) => {
    await page.goto("/?repo=owner/repo&theme=dark");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("falls back to the light theme for an unsupported theme", async ({ page }) => {
    await page.goto("/?repo=owner/repo&theme=neon");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("toggles the page theme and preserves the selection in the URL", async ({ page }) => {
    await page.goto("/?repo=owner/repo");

    const toggle = page.locator("#theme-toggle");
    await expect(page.locator("footer #theme-toggle")).toBeVisible();
    await expect(toggle).toHaveAccessibleName("Switch to dark theme");
    await expect(toggle.locator(".theme-icon-moon")).toBeVisible();
    await expect(toggle.locator(".theme-icon-sun")).toBeHidden();

    await toggle.click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(toggle).toHaveAccessibleName("Switch to light theme");
    await expect(toggle.locator(".theme-icon-moon")).toBeHidden();
    await expect(toggle.locator(".theme-icon-sun")).toBeVisible();
    await expect(page).toHaveURL(/repo=owner%2Frepo&theme=dark$/);

    await toggle.click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page).toHaveURL(/\?repo=owner%2Frepo$/);
  });

  test("includes the selected theme in the generated badge markdown", async ({ page }) => {
    await page.goto("/");

    await page.locator("#gen-repo").fill("owner/repo");
    await page.locator("#gen-theme").selectOption("dark");
    await page.locator("#generator-form button[type=submit]").click();

    await expect(page.locator("#generator-output")).toContainText("theme=dark");
  });

  test("omits the theme from the generated badge markdown for the light theme", async ({ page }) => {
    await page.goto("/");

    await page.locator("#gen-repo").fill("owner/repo");
    await page.locator("#gen-theme").selectOption("light");
    await page.locator("#generator-form button[type=submit]").click();

    const output = page.locator("#generator-output");
    await expect(output).toContainText("repo=owner%2Frepo");
    await expect(output).not.toContainText("theme=");
  });

  test("shows a validation message for an invalid repository in the generator", async ({ page }) => {
    await page.goto("/");

    await page.locator("#gen-repo").fill("not-a-valid-repo");
    await page.locator("#generator-form button[type=submit]").click();

    await expect(page.locator("#generator-output")).toContainText(
      "Please enter a valid GitHub repository"
    );
  });

  test("shows a validation message for an invalid path in the generator", async ({ page }) => {
    await page.goto("/");

    await page.locator("#gen-repo").fill("owner/repo");
    await page.locator("#gen-path").fill("../../etc/passwd");
    await page.locator("#generator-form button[type=submit]").click();

    await expect(page.locator("#generator-output")).toContainText(
      "Please enter a valid path within the repository"
    );
  });

  test("ignores an invalid path query parameter", async ({ page }) => {
    await page.goto("/?repo=owner/repo&path=../../etc/passwd");

    const installCard = page.locator("#install-card");
    await expect(installCard).toBeVisible();
    await expect(installCard.locator("dt", { hasText: "Path in repository" })).toHaveCount(0);
  });

  test("renders a script-like repo parameter as text instead of markup", async ({ page }) => {
    const injected = "<img src=x onerror=window.__xss=1>";
    await page.goto(`/?repo=${encodeURIComponent(injected)}&path=${encodeURIComponent(injected)}`);

    await expect(page.locator("#empty-state")).toBeVisible();
    await expect(page.locator("#install-card")).toBeHidden();
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(await page.locator("#install-card").innerHTML()).toBe("");
  });
});
