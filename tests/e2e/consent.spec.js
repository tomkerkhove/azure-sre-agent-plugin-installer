const { test, expect } = require("@playwright/test");

const INGESTION_HOST = "https://westeurope-1.in.applicationinsights.azure.com";
const CONNECTION_STRING =
  "InstrumentationKey=11111111-2222-3333-4444-555555555555;" +
  `IngestionEndpoint=${INGESTION_HOST}/`;

// The deployed site only enables analytics when the Pages workflow injects the
// ingestion connection string, so it is stubbed here before any script runs.
async function enableTelemetry(
  page,
  ingestionRequests,
  timeZone = "Europe/Brussels"
) {
  // Stand in for the config.js that the Pages workflow generates from the
  // repository secret.
  await page.route("**/assets/config.js", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body:
        "window.SITE_CONFIG = " +
        JSON.stringify({
          telemetry: {
            connectionString: CONNECTION_STRING,
            cloudRole: "sre-agent-plugin-installer",
          },
        }) +
        ";",
    });
  });

  // sendBeacon would bypass Playwright's request interception, so force the
  // fetch transport for these tests.
  await page.addInitScript((browserTimeZone) => {
    const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    Intl.DateTimeFormat.prototype.resolvedOptions = function () {
      return Object.assign({}, resolvedOptions.call(this), {
        timeZone: browserTimeZone,
      });
    };
    window.navigator.sendBeacon = undefined;
  }, timeZone);

  await page.route(`${INGESTION_HOST}/**`, async (route) => {
    ingestionRequests.push(JSON.parse(route.request().postData() || "[]"));
    await route.fulfill({ status: 200, body: "{}" });
  });
}

function envelopes(ingestionRequests) {
  return ingestionRequests.flat();
}

test.describe("Privacy consent", () => {
  test("hides the banner when analytics are not configured", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("#consent-banner")).toBeHidden();
    await expect(page.locator("#consent-status")).toHaveText(
      "Analytics are disabled on this deployment."
    );
  });

  test("asks for consent before collecting anything", async ({ page }) => {
    const ingestionRequests = [];
    await enableTelemetry(page, ingestionRequests);

    await page.goto("/?repo=owner/repo");

    await expect(page.locator("#consent-banner")).toBeVisible();
    await expect(page.locator("#consent-accept")).toBeVisible();
    await expect(page.locator("#consent-decline")).toBeVisible();
    await expect(page.locator("#consent-status")).toHaveText(
      "Anonymous analytics: awaiting your choice."
    );

    await page.locator("#copy-repo-btn").click();
    await page.waitForTimeout(250);
    expect(ingestionRequests).toHaveLength(0);
  });

  test("collects without prompting visitors outside Europe", async ({ page }) => {
    const ingestionRequests = [];
    await enableTelemetry(page, ingestionRequests, "America/New_York");

    await page.goto("/?repo=owner/repo");

    await expect(page.locator("#consent-banner")).toBeHidden();
    await expect(page.locator("#consent-status")).toHaveText(
      "Anonymous analytics: on."
    );
    await expect
      .poll(() => envelopes(ingestionRequests).length, { timeout: 5000 })
      .toBeGreaterThan(0);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("sre-agent-plugin-installer.analytics-consent")
      )
    ).toBeNull();
  });

  test("asks for consent when a fixed-offset time zone obscures the region", async ({
    page,
  }) => {
    const ingestionRequests = [];
    await enableTelemetry(page, ingestionRequests, "+01:00");

    await page.goto("/?repo=owner/repo");

    await expect(page.locator("#consent-banner")).toBeVisible();
    await page.waitForTimeout(250);
    expect(ingestionRequests).toHaveLength(0);
  });

  test("sets no cookies", async ({ page, context }) => {
    const ingestionRequests = [];
    await enableTelemetry(page, ingestionRequests);

    await page.goto("/?repo=owner/repo");
    await page.locator("#consent-accept").click();
    await page.locator("#copy-repo-btn").click();

    expect(await context.cookies()).toHaveLength(0);
    expect(await page.evaluate(() => document.cookie)).toBe("");
  });

  test("collects telemetry after the visitor allows analytics", async ({ page }) => {
    const ingestionRequests = [];
    await enableTelemetry(page, ingestionRequests);

    await page.goto("/?repo=owner/repo");
    await page.locator("#consent-accept").click();

    await expect(page.locator("#consent-banner")).toBeHidden();
    await expect(page.locator("#consent-status")).toHaveText("Anonymous analytics: on.");

    await expect
      .poll(() => envelopes(ingestionRequests).length, { timeout: 5000 })
      .toBeGreaterThan(0);

    const pageView = envelopes(ingestionRequests).find(
      (envelope) => envelope.data.baseType === "PageviewData"
    );
    expect(pageView).toBeTruthy();
    expect(pageView.data.baseData.properties.scenario).toBe("plugin-install");
    expect(pageView.data.baseData.properties.repository).toBe("owner/repo");
  });

  test("reports the plugin install metric with the repository name", async ({ page }) => {
    const ingestionRequests = [];
    await enableTelemetry(page, ingestionRequests);

    await page.goto("/?repo=owner/repo");
    await page.locator("#consent-accept").click();
    await page.locator("#copy-repo-btn").click();

    await expect
      .poll(
        () =>
          envelopes(ingestionRequests).filter(
            (envelope) => envelope.data.baseType === "MetricData"
          ).length,
        { timeout: 5000 }
      )
      .toBeGreaterThan(0);

    const metric = envelopes(ingestionRequests).find(
      (envelope) => envelope.data.baseType === "MetricData"
    );
    expect(metric.data.baseData.metrics[0].name).toBe("PluginInstalls");
    expect(metric.data.baseData.metrics[0].value).toBe(1);
    expect(metric.data.baseData.properties.repository).toBe("owner/repo");
  });

  test("collects nothing when the visitor declines", async ({ page }) => {
    const ingestionRequests = [];
    await enableTelemetry(page, ingestionRequests);

    await page.goto("/?repo=owner/repo");
    await page.locator("#consent-decline").click();

    await expect(page.locator("#consent-banner")).toBeHidden();
    await expect(page.locator("#consent-status")).toHaveText("Anonymous analytics: off.");

    await page.locator("#copy-repo-btn").click();
    await page.waitForTimeout(250);
    expect(ingestionRequests).toHaveLength(0);
  });

  test("remembers the decision on the next visit", async ({ page }) => {
    const ingestionRequests = [];
    await enableTelemetry(page, ingestionRequests);

    await page.goto("/");
    await page.locator("#consent-decline").click();

    await page.goto("/?repo=owner/repo");
    await expect(page.locator("#consent-banner")).toBeHidden();
    await page.waitForTimeout(250);
    expect(ingestionRequests).toHaveLength(0);
  });

  test("lets the visitor change their privacy choice", async ({ page }) => {
    const ingestionRequests = [];
    await enableTelemetry(page, ingestionRequests);

    await page.goto("/");
    await page.locator("#consent-accept").click();
    await expect(page.locator("#consent-banner")).toBeHidden();

    await page.locator("#consent-change").click();

    await expect(page.locator("#consent-banner")).toBeVisible();
    await expect(page.locator("#consent-status")).toHaveText(
      "Anonymous analytics: awaiting your choice."
    );
  });
});
