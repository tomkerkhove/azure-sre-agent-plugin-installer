const { test, expect } = require("@playwright/test");

test.describe("Install to Azure SRE Agent site", () => {
  test("shows the empty state when no repo is specified", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("#empty-state")).toBeVisible();
    await expect(page.locator("#install-card")).toBeHidden();
    await expect(page.locator("h1")).toHaveText("Install to Azure SRE Agent");
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
    await expect(toggle).toHaveText("Dark theme");

    await toggle.click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(toggle).toHaveText("Light theme");
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
});
