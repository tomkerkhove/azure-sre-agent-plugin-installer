const { test, expect } = require("@playwright/test");

async function configureOnlineInstaller(page, clientMethods) {
  await page.route("**/assets/config.js", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: `
        window.SRE_AGENT_INSTALLER_CONFIG = Object.freeze({
          clientId: "11111111-1111-4111-8111-111111111111",
          tenantId: "organizations",
          dataPlaneScope: "https://azuresre.dev/.default"
        });
        window.SITE_CONFIG = { telemetry: { connectionString: "" } };
      `,
    });
  });

  await page.route("**/assets/vendor/msal-browser.min.js", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: `
        window.msal = {
          InteractionRequiredAuthError: class extends Error {},
          PublicClientApplication: class {
            async initialize() {}
            ${clientMethods}
          }
        };
      `,
    });
  });
}

test.describe("Install to Azure SRE Agent site", () => {
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
    await expect(page.locator("#portal-install-option")).toHaveAttribute("open", "");
    await expect(page.locator("#cli-install-option")).toHaveAttribute("open", "");
    await expect(page.locator("#api-import-form")).toBeVisible();
  });

  test("shows each installation method as a peer drawer", async ({ page }) => {
    await page.goto("/?repo=owner/repo");

    const options = page.locator("#install-card > .installation-option");
    await expect(options).toHaveCount(3);
    await expect(options.locator("summary")).toHaveText([
      "Choose an Azure SRE Agent",
      "Install in the Azure portal",
      "Generate an Azure CLI command",
    ]);
    await expect(page.locator("#online-install-option")).toHaveAttribute("open", "");
    await expect(page.locator("#alternative-options")).toHaveCount(0);
  });

  test("opens fallback drawers when authentication fails", async ({ page }) => {
    await configureOnlineInstaller(
      page,
      `async loginPopup() {
        throw Object.assign(new Error("Consent is required"), {
          errorCode: "consent_required"
        });
      }`
    );
    await page.goto("/?repo=owner/repo");

    await expect(page.locator("#portal-install-option")).not.toHaveAttribute("open", "");
    await expect(page.locator("#cli-install-option")).not.toHaveAttribute("open", "");
    await page.locator("#sign-in-btn").click();

    await expect(page.locator("#online-status")).toContainText(
      "isn't permitted to request the required Azure access"
    );
    await expect(page.locator("#portal-install-option")).toHaveAttribute("open", "");
    await expect(page.locator("#cli-install-option")).toHaveAttribute("open", "");
  });

  test("opens fallback drawers when installation fails", async ({ page }) => {
    await configureOnlineInstaller(
      page,
      `async loginPopup() {
        return {
          account: { username: "user@example.com" },
          accessToken: "management-token"
        };
      }
      async acquireTokenPopup() {
        throw new Error("Installation token failed");
      }`
    );
    await page.route("https://management.azure.com/providers/Microsoft.ResourceGraph/resources?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [{
            id: "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.App/agents/demo",
            name: "demo",
            subscriptionId: "sub",
            resourceGroup: "rg",
            location: "eastus",
            agentEndpoint: "https://demo.hash.eastus.azuresre.ai",
            powerState: "Running"
          }]
        }),
      });
    });
    await page.goto("/?repo=owner/repo");
    await page.locator("#sign-in-btn").click();
    await page.locator("#agent-select").selectOption("0");

    await expect(page.locator("#portal-install-option")).not.toHaveAttribute("open", "");
    await expect(page.locator("#cli-install-option")).not.toHaveAttribute("open", "");
    await page.locator("#install-btn").click();

    await expect(page.locator("#online-status")).toContainText(
      "The plugin couldn't be installed"
    );
    await expect(page.locator("#portal-install-option")).toHaveAttribute("open", "");
    await expect(page.locator("#cli-install-option")).toHaveAttribute("open", "");
  });

  test("shows the path in repository when the path query parameter is provided", async ({ page }) => {
    await page.goto("/?repo=owner/repo&path=plugins/my-plugin");

    const installCard = page.locator("#install-card");
    await expect(installCard.locator("dt", { hasText: "Path in repository" })).toBeVisible();
    await expect(installCard.locator("dd code")).toHaveText("plugins/my-plugin");
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
