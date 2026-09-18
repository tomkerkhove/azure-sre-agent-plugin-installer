const { test, expect } = require("@playwright/test");

// `getComputedStyle` reports durations with their unit ("0.2s" or "0.01ms"),
// so they are normalized to milliseconds before being compared.
function toMilliseconds(duration) {
  const value = parseFloat(duration);
  return /ms$/.test(duration) ? value : value * 1000;
}

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

      await page.keyboard.press("Enter");
      await expect(page.locator("main#main-content")).toBeFocused();
    });

    test(`shows a focus outline on keyboard focus on ${path}`, async ({ page }) => {
      await page.goto(path);

      // `:focus-visible` only matches when the browser is in keyboard
      // modality, so the control is reached with the keyboard rather than a
      // programmatic focus call alone.
      const toggle = page.locator("#theme-toggle");
      await toggle.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(toggle).toBeFocused();

      const outline = await toggle.evaluate((element) => {
        const styles = window.getComputedStyle(element);
        return {
          style: styles.outlineStyle,
          width: styles.outlineWidth,
          offset: styles.outlineOffset,
        };
      });

      expect(outline.style).not.toBe("none");
      expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
      expect(parseFloat(outline.offset)).toBeGreaterThan(0);
    });

    test(`suppresses transitions when reduced motion is preferred on ${path}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(path);

      const durations = await page.evaluate(() =>
        [
          document.querySelector(".skip-link"),
          document.querySelector("#toast"),
        ].map((element) => window.getComputedStyle(element).transitionDuration)
      );

      durations.forEach((duration) => {
        expect(toMilliseconds(duration)).toBeLessThanOrEqual(1);
      });

      await page.emulateMedia({ reducedMotion: "no-preference" });
      const defaultDuration = await page.evaluate(
        () => window.getComputedStyle(document.querySelector("#toast")).transitionDuration
      );
      expect(toMilliseconds(defaultDuration)).toBeGreaterThan(1);
    });

    test(`announces toast messages on ${path}`, async ({ page }) => {
      await page.goto(path);

      const toast = page.locator("#toast");
      await expect(toast).toHaveAttribute("role", "status");
      await expect(toast).toHaveAttribute("aria-live", "polite");
      await expect(toast).toHaveAttribute("aria-atomic", "true");
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

  test("reports an empty repository accessibly instead of a native bubble", async ({ page }) => {
    await page.goto("/");

    await page.locator("#generator-form button[type=submit]").click();

    const repoField = page.locator("#gen-repo");
    const error = page.locator("#generator-error");
    await expect(error).toContainText("Please enter a valid GitHub repository");
    await expect(repoField).toBeFocused();
    await expect(repoField).toHaveAttribute("aria-invalid", "true");
    await expect(repoField).toHaveAttribute("aria-describedby", "generator-error");

    await page.goto("/install.html");
    await page.locator("#plugin-details-form button[type=submit]").click();

    await expect(page.locator("#plugin-details-error")).toContainText(
      "Please enter a valid GitHub repository"
    );
    await expect(page.locator("#plugin-repo")).toBeFocused();
  });

  test("moves focus to the generator field that failed validation", async ({ page }) => {
    await page.goto("/");

    await page.locator("#gen-repo").fill("owner/repo");
    await page.locator("#gen-path").fill("../../etc/passwd");
    await page.locator("#generator-form button[type=submit]").click();

    const pathField = page.locator("#gen-path");
    await expect(pathField).toBeFocused();
    await expect(pathField).toHaveAttribute("aria-invalid", "true");
    await expect(pathField).toHaveAttribute("aria-describedby", "generator-error");
  });
});
