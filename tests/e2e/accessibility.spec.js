const { test, expect } = require("@playwright/test");

test.describe("accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("https://api.github.com/**", async (route) => {
      await route.fulfill({ status: 404, body: "{}" });
    });
  });

  for (const path of ["/", "/install.html"]) {
    test(`exposes a main landmark and a skip link on ${path}`, async ({ page }) => {
      await page.goto(path);

      await expect(page.locator("main#main-content")).toHaveCount(1);
      await expect(page.locator("main#main-content h1")).toBeVisible();

      const skipLink = page.getByRole("link", { name: "Skip to main content" });
      await expect(skipLink).toHaveAttribute("href", "#main-content");
      await expect(skipLink).not.toBeInViewport();

      await page.keyboard.press("Tab");
      await expect(skipLink).toBeFocused();
      await expect(skipLink).toBeInViewport();
    });

    test(`announces toast messages on ${path}`, async ({ page }) => {
      await page.goto(path);

      const toast = page.locator("#toast");
      await expect(toast).toHaveAttribute("role", "status");
      await expect(toast).toHaveAttribute("aria-live", "polite");
    });

    test(`offers the privacy reset as a button on ${path}`, async ({ page }) => {
      await page.goto(path);

      const change = page.locator("#consent-change");
      await expect(change).toHaveJSProperty("tagName", "BUTTON");
      await expect(change).toHaveJSProperty("type", "button");
    });
  }

  test("names the copy controls unambiguously", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("#copy-badge-btn")).toHaveAccessibleName(
      "Copy badge markdown"
    );

    await page.goto("/install.html?repo=owner/repo");
    await page.locator("#portal-install-option summary").click();

    await expect(page.locator("#copy-repo-btn")).toHaveAccessibleName(
      "Copy repository"
    );
    await expect(page.locator("#repo-value")).toHaveAccessibleName(
      "Repository to paste in the Azure portal"
    );
  });

  test("moves focus to the field that failed validation", async ({ page }) => {
    await page.goto("/install.html");

    await page.locator("#plugin-repo").fill("not-a-repository");
    await page.locator("#plugin-details-form button[type=submit]").click();

    const repoField = page.locator("#plugin-repo");
    await expect(repoField).toBeFocused();
    await expect(repoField).toHaveAttribute("aria-invalid", "true");
    await expect(repoField).toHaveAttribute(
      "aria-describedby",
      "plugin-details-error"
    );
  });
});
