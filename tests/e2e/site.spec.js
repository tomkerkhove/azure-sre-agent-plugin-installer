const { test, expect } = require("@playwright/test");

async function expectThemeToggleState(toggle, theme) {
  if (theme === "dark") {
    await expect(toggle).toHaveAccessibleName("Switch to light theme");
    await expect(toggle.locator(".theme-icon-moon")).toBeHidden();
    await expect(toggle.locator(".theme-icon-sun")).toBeVisible();
    return;
  }

  await expect(toggle).toHaveAccessibleName("Switch to dark theme");
  await expect(toggle.locator(".theme-icon-moon")).toBeVisible();
  await expect(toggle.locator(".theme-icon-sun")).toBeHidden();
}

test.describe("Install to Azure SRE Agent site", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("https://api.github.com/**", async (route) => {
      await route.fulfill({ status: 404, body: "{}" });
    });
  });

  test("shows the plugin details form when no repo is specified", async ({ page }) => {
    await page.goto("/install.html");

    await expect(page.locator("#empty-state")).toBeVisible();
    await expect(page.locator("#plugin-details-form")).toBeVisible();
    await expect(page.locator("#install-card")).toBeHidden();
    await expect(page.locator("h1")).toHaveText("Install a plugin into your agent");
  });

  test("continues to the install flow with manually entered plugin details", async ({ page }) => {
    await page.goto("/install.html");

    await page.locator("#plugin-repo").fill("https://github.com/owner/repo");
    await page.locator("#plugin-path").fill("plugins/my-plugin");
    await page.locator("#plugin-details-form button[type=submit]").click();

    await expect(page.locator("#empty-state")).toBeHidden();
    await expect(page.locator("#install-card")).toBeVisible();
    await expect(page.locator("#install-card h2 span")).toHaveText("owner/repo");
    await expect(page.locator("#install-card dd code")).toHaveText("plugins/my-plugin");
    await expect(page).toHaveURL(
      /\/install\.html\?repo=owner%2Frepo&path=plugins%2Fmy-plugin$/
    );
  });

  test("validates manually entered plugin details", async ({ page }) => {
    await page.goto("/install.html");

    await page.locator("#plugin-repo").fill("not-a-repository");
    await page.locator("#plugin-details-form button[type=submit]").click();

    await expect(page.locator("#plugin-details-error")).toContainText(
      "Please enter a valid GitHub repository"
    );
    await expect(page.locator("#install-card")).toBeHidden();

    await page.locator("#plugin-repo").fill("owner/repo");
    await page.locator("#plugin-path").fill("../../etc/passwd");
    await page.locator("#plugin-details-form button[type=submit]").click();

    await expect(page.locator("#plugin-details-error")).toContainText(
      "Please enter a valid path within the repository"
    );
    await expect(page.locator("#install-card")).toBeHidden();
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

  test("exposes a CSP that permits GitHub README API and image sources", async ({ page }) => {
    await page.goto("/");

    const policy = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute("content");

    expect(policy).toContain("connect-src https://api.github.com");
    expect(policy).toContain("img-src 'self' https://github.com");
    expect(policy).toContain("https://*.githubusercontent.com");
  });

  test("renders the install card when a repo query parameter is provided", async ({ page }) => {
    await page.goto("/install.html?repo=owner/repo");

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
    await page.goto("/install.html?repo=owner/repo");

    const installationOptions = page.locator("#install-card > details");
    await expect(installationOptions).toHaveCount(3);
    await expect(installationOptions.locator("summary")).toHaveText([
      "Choose an Azure SRE Agent",
      "Install in the Azure portal",
      "Generate an Azure CLI command",
    ]);
    await expect(page.getByText("Other installation options")).toHaveCount(0);
    await expect(page.locator("#sign-in-btn")).toBeDisabled();
    await expect(page.locator("#online-status")).toContainText(
      "Online installation isn't configured yet"
    );
    await expect(page.locator("#agent-install-option")).toHaveAttribute("open", "");
    await expect(page.locator("#portal-install-option")).not.toHaveAttribute("open", "");
    await expect(page.locator("#cli-install-option")).not.toHaveAttribute("open", "");
    await expect(page.locator("#api-import-form")).toBeHidden();
  });

  test("generates an Azure CLI import command", async ({ page }) => {
    await page.goto("/install.html?repo=owner/repo&path=plugins/my-plugin");
    await page.locator("#cli-install-option summary").click();

    await page.locator("#agent-endpoint").fill(
      "https://demo.hash.eastus.azuresre.ai"
    );
    await page.locator("#api-import-form button[type=submit]").click();

    const output = page.locator("#import-output");
    await expect(output).toBeVisible();
    await expect(output).toContainText(
      "--url 'https://demo.hash.eastus.azuresre.ai/api/v2/plugins/install-direct'"
    );
    await expect(output).toContainText(
      `--data '{"sourceUrl":"owner/repo","pathInRepo":"plugins/my-plugin"}'`
    );
    await expect(page.locator("#copy-import-btn")).toBeEnabled();
  });

  test("rejects an invalid Azure SRE Agent endpoint", async ({ page }) => {
    await page.goto("/install.html?repo=owner/repo");
    await page.locator("#cli-install-option summary").click();

    const endpointInput = page.locator("#agent-endpoint");
    const submitButton = page.locator(
      "#api-import-form button[type=submit]"
    );
    const copyButton = page.locator("#copy-import-btn");

    await endpointInput.fill("https://demo.hash.eastus.azuresre.ai");
    await submitButton.click();
    await expect(copyButton).toBeEnabled();

    await endpointInput.fill("https://demo.azuresre.ai.attacker.example");
    await submitButton.click();

    await expect(page.locator("#import-output")).toHaveText(
      "Enter a valid Azure SRE Agent endpoint ending in .azuresre.ai."
    );
    await expect(copyButton).toBeDisabled();
  });

  test("shows the path in repository when the path query parameter is provided", async ({ page }) => {
    await page.goto("/install.html?repo=owner/repo&path=plugins/my-plugin");

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
          contentType: "application/json",
          body: JSON.stringify({
            content: `
            <h1>Azure Carbon SRE</h1>
            <p>An Azure SRE Agent plugin marketplace.</p>
            <h2>Included plugin</h2>
            <table><tbody><tr><td><code>azure-carbon-sre</code></td></tr></tbody></table>
            <img src="images/plugin.png" alt="Plugin diagram">
          `,
          }),
        });
      }
    );

    await page.goto("/install.html?repo=tomkerkhove/azure-carbon-sre");

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
    await page.goto("/install.html?repo=owner/missing-readme");

    await expect(page.locator("#repository-readme-status")).toHaveText(
      "The README preview is unavailable. View it on GitHub instead."
    );
    await expect(page.locator("#repository-readme-content")).toBeHidden();
    await expect(
      page.locator(".repository-readme a", { hasText: "View on GitHub" })
    ).toHaveAttribute("href", "https://github.com/owner/missing-readme");
  });

  test("keeps the README widget within a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/install.html?repo=owner/repo");

    await expect(page.locator(".repository-readme-header")).toBeVisible();
    expect(
      await page
        .locator(".repository-readme-header")
        .evaluate((header) => header.scrollWidth <= header.clientWidth)
    ).toBe(true);
  });

  test("normalizes a full GitHub URL passed as the repo parameter", async ({ page }) => {
    await page.goto("/install.html?repo=https://github.com/owner/repo");

    await expect(page.locator("#install-card h2 span")).toHaveText("owner/repo");
  });

  test("shows the empty state for an invalid repo parameter", async ({ page }) => {
    await page.goto("/install.html?repo=not-a-valid-repo");

    await expect(page.locator("#empty-state")).toBeVisible();
    await expect(page.locator("#install-card")).toBeHidden();
  });

  test("copies the repository to the clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/install.html?repo=owner/repo");
    await page.locator("#portal-install-option summary").click();

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
    await expect(output).toContainText("install.html?repo=owner%2Frepo");
    await expect(output).toContainText("path=plugins%2Fmy-plugin");
  });

  test("renders the landing page hero logo and intro", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("header.hero")).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Azure SRE Agent Plugin Installer" })
    ).toBeVisible();
    await expect(page.locator("header.hero p")).toHaveCount(0);
    await expect(page.locator(".page-intro h1")).toHaveText(
      "Generate your installation badge"
    );
    await expect(page.locator(".page-intro")).toContainText(
      "Help users discover and install your Azure SRE Agent plugin in one click."
    );
  });

  test("shows the install page intro in the redesigned layout", async ({ page }) => {
    await page.goto("/install.html");

    await expect(
      page.getByRole("img", { name: "Azure SRE Agent Plugin Installer" })
    ).toBeVisible();
    await expect(page.locator("header.hero p")).toHaveCount(0);
    await expect(page.locator(".page-intro h1")).toHaveText(
      "Install a plugin into your agent"
    );
    await expect(page.locator(".page-intro")).toContainText(
      "Install an Azure SRE Agent plugin into your own instance in one click."
    );
    const sreAgentLink = page.locator(
      '.page-intro a[href="https://aka.ms/sreagent"]'
    );
    await expect(sreAgentLink).toBeVisible();
    await expect(sreAgentLink).toHaveText("Azure SRE Agent");
    await expect(sreAgentLink).toHaveAttribute("target", "_blank");
    await expect(sreAgentLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("uses the light theme by default", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator(".brand-logo")).toBeVisible();
    await expect(page.locator("h1")).toHaveText(
      "Generate your installation badge"
    );
    await expect(page.locator(".brand-logo")).toHaveCSS(
      "background-image",
      /logo-horizontal-light\.svg/
    );
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
      "href",
      "assets/logos/favicon/favicon.ico"
    );
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      "https://tomkerkhove.github.io/azure-sre-agent-plugin-installer/assets/logos/png/github-social-card-light-1280x640.png"
    );
  });

  test("uses the dark theme when the theme query parameter is dark", async ({ page }) => {
    await page.goto("/install.html?repo=owner/repo&theme=dark");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator(".brand-logo")).toHaveCSS(
      "background-image",
      /logo-horizontal-dark\.svg/
    );
  });

  test("falls back to the light theme for an unsupported theme", async ({ page }) => {
    await page.goto("/install.html?repo=owner/repo&theme=neon");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("applies the dark theme before the page finishes loading, avoiding a flash of the light theme", async ({
    page,
  }) => {
    // assets/theme-init.js is a blocking, synchronous <script> that loads
    // before assets/style.css in <head> (see index.html/install.html), so
    // the browser cannot request the stylesheet until theme-init.js has
    // finished executing. Waiting for that stylesheet request (rather than
    // an arbitrary timeout, or `waitUntil: "commit"` alone) gives a
    // deterministic point at which theme-init.js is guaranteed to already
    // have applied the theme, without waiting for assets/app.js to run on
    // `DOMContentLoaded` - which would mask a regression where
    // theme-init.js was removed or delayed.
    const stylesheetRequested = new Promise((resolve) => {
      page.route("**/assets/style.css", (route) => {
        resolve();
        route.abort();
      });
    });

    await page.goto("/install.html?repo=owner/repo&theme=dark", {
      waitUntil: "commit",
    });
    await stylesheetRequested;

    // Read the attribute once immediately instead of using an
    // auto-retrying `expect(...).toHaveAttribute(...)`, which would keep
    // polling until assets/app.js applies the theme on `DOMContentLoaded`
    // and could pass even if the synchronous, up-front application in
    // assets/theme-init.js were removed or delayed.
    const themeBeforeStylesheetLoads = await page
      .locator("html")
      .getAttribute("data-theme");
    expect(themeBeforeStylesheetLoads).toBe("dark");
  });

  test("toggles the page theme and preserves the selection in the URL", async ({ page }) => {
    await page.goto("/install.html?repo=owner/repo");

    const toggle = page.locator("#theme-toggle");
    await expect(page.locator("footer #theme-toggle")).toBeVisible();
    await expectThemeToggleState(toggle, "light");

    await toggle.click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expectThemeToggleState(toggle, "dark");
    await expect(page).toHaveURL(/repo=owner%2Frepo&theme=dark$/);

    await toggle.click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page).toHaveURL(/\?repo=owner%2Frepo$/);
  });

  test("toggles the theme and updates the URL on the landing page", async ({ page }) => {
    await page.goto("/");

    const toggle = page.locator("#theme-toggle");
    await expect(page.locator("footer #theme-toggle")).toBeVisible();
    await expectThemeToggleState(toggle, "light");

    await toggle.click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expectThemeToggleState(toggle, "dark");
    await expect(page).toHaveURL(/\?theme=dark$/);

    await toggle.click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expectThemeToggleState(toggle, "light");
    await expect(page).toHaveURL(/\/$/);
  });

  test("keeps the dark theme when using the site-nav links", async ({ page }) => {
    await page.goto("/install.html?repo=owner/repo&theme=dark");

    await expect(page.locator(".site-nav-link", { hasText: "Generate a badge" })).toHaveAttribute(
      "href",
      "/index.html?theme=dark"
    );

    await page.locator(".site-nav-link", { hasText: "Generate a badge" }).click();

    await expect(page).toHaveURL(/\/index\.html\?theme=dark$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await expect(page.locator(".site-nav-link", { hasText: "Install a plugin" })).toHaveAttribute(
      "href",
      "/install.html?theme=dark"
    );

    await page.locator(".site-nav-link", { hasText: "Install a plugin" }).click();

    await expect(page).toHaveURL(/\/install\.html\?theme=dark$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("updates the site-nav links after toggling the theme", async ({ page }) => {
    await page.goto("/install.html?repo=owner/repo");

    await expect(page.locator(".site-nav-link", { hasText: "Generate a badge" })).toHaveAttribute(
      "href",
      "/index.html"
    );

    await page.locator("#theme-toggle").click();

    await expect(page.locator(".site-nav-link", { hasText: "Generate a badge" })).toHaveAttribute(
      "href",
      "/index.html?theme=dark"
    );
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
    await page.goto("/install.html?repo=owner/repo&path=../../etc/passwd");

    const installCard = page.locator("#install-card");
    await expect(installCard).toBeVisible();
    await expect(installCard.locator("dt", { hasText: "Path in repository" })).toHaveCount(0);
  });

  test("renders a script-like repo parameter as text instead of markup", async ({ page }) => {
    const injected = "<img src=x onerror=window.__xss=1>";
    await page.goto(`/install.html?repo=${encodeURIComponent(injected)}&path=${encodeURIComponent(injected)}`);

    await expect(page.locator("#empty-state")).toBeVisible();
    await expect(page.locator("#install-card")).toBeHidden();
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(await page.locator("#install-card").innerHTML()).toBe("");
  });

  test("navigates from the landing page to the install page and back", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator(".site-nav-link", { hasText: "Generate a badge" })).toHaveAttribute(
      "aria-current",
      "page"
    );

    await page.locator(".site-nav-link", { hasText: "Install a plugin" }).click();
    await expect(page).toHaveURL(/\/install\.html$/);
    await expect(page.locator(".site-nav-link", { hasText: "Install a plugin" })).toHaveAttribute(
      "aria-current",
      "page"
    );

    await page.locator(".site-nav-link", { hasText: "Generate a badge" }).click();
    await expect(page).toHaveURL(/\/(index\.html)?$/);
    await expect(page.locator("#generator-form")).toBeVisible();
  });

  test("redirects legacy badge links from the landing page to the install page", async ({ page }) => {
    await page.goto("/?repo=owner/repo&path=plugins/my-plugin&theme=dark");

    await expect(page).toHaveURL(/\/install\.html\?repo=owner\/repo&path=plugins\/my-plugin&theme=dark$/);
    await expect(page.locator("#install-card")).toBeVisible();
    await expect(page.locator("#install-card h2 span")).toHaveText("owner/repo");
  });
});
