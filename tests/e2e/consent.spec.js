const { test, expect } = require("@playwright/test");

const INGESTION_HOST = "https://westeurope-1.in.applicationinsights.azure.com";
const CONNECTION_STRING =
  "InstrumentationKey=11111111-2222-3333-4444-555555555555;" +
  `IngestionEndpoint=${INGESTION_HOST}/`;

// The deployed site only enables analytics when the Pages workflow injects the
// ingestion connection string, so it is stubbed here before any script runs.
async function enableTelemetry(page, ingestionRequests, options = {}) {
  const {
    enableInstaller = false,
    timeZone = "Europe/Brussels",
  } = options;
  // Stand in for the config.js that the Pages workflow generates from the
  // repository secret.
  await page.route("**/assets/config.js", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: [
        "window.SITE_CONFIG = " +
          JSON.stringify({
            telemetry: {
              connectionString: CONNECTION_STRING,
              cloudRole: "sre-agent-plugin-installer",
            },
          }) +
          ";",
        enableInstaller
          ? "window.SRE_AGENT_INSTALLER_CONFIG = " +
            JSON.stringify({
              clientId: "11111111-1111-4111-8111-111111111111",
              tenantId: "organizations",
              dataPlaneScope: "https://azuresre.dev/.default",
            }) +
            ";"
          : "",
      ].join("\n"),
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

async function enableOnlineInstaller(page, ingestionRequests) {
  await enableTelemetry(page, ingestionRequests, { enableInstaller: true });
  await page.route("**/assets/vendor/msal-browser.min.js", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: `
        window.msal = {
          InteractionRequiredAuthError: class InteractionRequiredAuthError extends Error {},
          PublicClientApplication: class PublicClientApplication {
            async initialize() {}
            async loginPopup() {
              return {
                account: { username: "visitor@example.com" },
                accessToken: "management-token"
              };
            }
            async acquireTokenPopup() {
              return {
                account: { username: "visitor@example.com" },
                accessToken: "data-plane-token"
              };
            }
            async acquireTokenSilent() {
              return { accessToken: "management-token" };
            }
          }
        };
      `,
    });
  });
}

function envelopes(ingestionRequests) {
  return ingestionRequests.flat();
}

test.describe("Privacy consent", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("https://api.github.com/**", async (route) => {
      await route.fulfill({ status: 404, body: "{}" });
    });
  });

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

    await page.goto("/install.html?repo=owner/repo");

    await expect(page.locator("#consent-banner")).toBeVisible();
    await expect(page.locator("#consent-accept")).toBeVisible();
    await expect(page.locator("#consent-decline")).toBeVisible();
    await expect(page.locator("#consent-status")).toHaveText(
      "Anonymous analytics: awaiting your choice."
    );
    await expect(page.locator("#consent-banner")).toContainText(
      "usage and reliability analytics"
    );
    await expect(page.locator("#consent-banner")).toContainText(
      "application error categories"
    );
    await expect(page.locator("#consent-banner")).toContainText(
      "known to be outside Europe"
    );
    await expect(page.locator("#consent-banner")).toContainText(
      "otherwise, nothing is collected unless you agree"
    );

    await page.locator("#copy-repo-btn").click();
    await page.waitForTimeout(250);
    expect(ingestionRequests).toHaveLength(0);
  });

  test("collects without prompting visitors outside Europe", async ({ page }) => {
    const ingestionRequests = [];
    await enableTelemetry(page, ingestionRequests, {
      timeZone: "America/New_York",
    });

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

    await page.locator("#consent-change").click();
    await expect(page.locator("#consent-banner")).toBeVisible();
    await expect(page.locator("#consent-banner")).toContainText(
      "known to be outside Europe"
    );
  });

  test("asks for consent when a fixed-offset time zone obscures the region", async ({
    page,
  }) => {
    const ingestionRequests = [];
    await enableTelemetry(page, ingestionRequests, { timeZone: "+01:00" });

    await page.goto("/?repo=owner/repo");

    await expect(page.locator("#consent-banner")).toBeVisible();
    await page.waitForTimeout(250);
    expect(ingestionRequests).toHaveLength(0);
  });

  test("sets no cookies", async ({ page, context }) => {
    const ingestionRequests = [];
    await enableTelemetry(page, ingestionRequests);

    await page.goto("/install.html?repo=owner/repo");
    await page.locator("#consent-accept").click();
    await page.locator("#copy-repo-btn").click();

    expect(await context.cookies()).toHaveLength(0);
    expect(await page.evaluate(() => document.cookie)).toBe("");
  });

  test("collects telemetry after the visitor allows analytics", async ({ page }) => {
    const ingestionRequests = [];
    await enableTelemetry(page, ingestionRequests);

    await page.goto("/install.html?repo=owner/repo");
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

  test("classifies the no-query install page as plugin installation", async ({ page }) => {
    const ingestionRequests = [];
    await enableTelemetry(page, ingestionRequests);

    await page.goto("/install.html");
    await page.locator("#consent-accept").click();

    await expect
      .poll(() => envelopes(ingestionRequests).length, { timeout: 5000 })
      .toBeGreaterThan(0);

    const pageView = envelopes(ingestionRequests).find(
      (envelope) => envelope.data.baseType === "PageviewData"
    );
    expect(pageView).toBeTruthy();
    expect(pageView.data.baseData.properties.scenario).toBe("plugin-install");
    expect(pageView.data.baseData.properties.repository).toBe("");
  });

  test("reports the plugin install metric with the repository name", async ({ page, context }) => {
    const ingestionRequests = [];
    await enableTelemetry(page, ingestionRequests);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    await page.goto("/install.html?repo=owner/repo");
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

  test("reports error categories without exception details", async ({ page }) => {
    const ingestionRequests = [];
    await enableTelemetry(page, ingestionRequests);

    await page.goto("/");
    await page.locator("#consent-accept").click();
    await page.evaluate(() => {
      const error = new TypeError("token=private-value");
      error.stack = "private stack trace";
      window.dispatchEvent(
        new ErrorEvent("error", {
          error,
          message: error.message,
        })
      );
    });

    await expect
      .poll(
        () =>
          envelopes(ingestionRequests).filter(
            (envelope) => envelope.data.baseType === "ExceptionData"
          ).length,
        { timeout: 5000 }
      )
      .toBe(1);

    const exception = envelopes(ingestionRequests).find(
      (envelope) => envelope.data.baseType === "ExceptionData"
    );
    expect(exception.data.baseData.exceptions[0]).toEqual({
      id: 1,
      outerId: 0,
      typeName: "TypeError",
      message: "An application exception occurred.",
      hasFullStack: false,
      stack: "Stack trace omitted for privacy.",
      parsedStack: [],
    });
    expect(exception.data.baseData.properties.source).toBe("window-error");
    expect(JSON.stringify(exception)).not.toContain("private-value");
    expect(JSON.stringify(exception)).not.toContain("private stack trace");
  });

  test("reports agent discovery failures with safe operation context", async ({ page }) => {
    const ingestionRequests = [];
    await enableOnlineInstaller(page, ingestionRequests);
    await page.route("https://management.azure.com/**", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "private discovery details" }),
      });
    });

    await page.goto("/install.html?repo=owner/plugin");
    await page.locator("#consent-accept").click();
    await page.locator("#sign-in-btn").click();

    await expect(page.locator("#online-status")).toContainText(
      "Azure returned: private discovery details"
    );
    await expect
      .poll(
        () =>
          envelopes(ingestionRequests).find(
            (envelope) =>
              envelope.data.baseType === "ExceptionData" &&
              envelope.data.baseData.properties.operation === "list-agents"
          ),
        { timeout: 5000 }
      )
      .toBeTruthy();

    const exception = envelopes(ingestionRequests).find(
      (envelope) =>
        envelope.data.baseType === "ExceptionData" &&
        envelope.data.baseData.properties.operation === "list-agents"
    );
    expect(exception.data.baseData.properties).toEqual({
      handled: "true",
      operation: "list-agents",
      status: "500",
    });
    expect(JSON.stringify(exception)).not.toContain("private discovery details");
  });

  test("reports plugin installation failures with safe operation context", async ({ page }) => {
    const ingestionRequests = [];
    await enableOnlineInstaller(page, ingestionRequests);
    await page.route("https://management.azure.com/**", async (route) => {
      if (route.request().url().includes("Microsoft.ResourceGraph/resources")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: [
              {
                id: "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.App/agents/demo",
                name: "demo",
                subscriptionId: "sub",
                resourceGroup: "rg",
                location: "eastus",
                agentEndpoint: "https://demo.hash.eastus.azuresre.ai",
                powerState: "Running",
              },
            ],
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          properties: {
            agentEndpoint: "https://demo.hash.eastus.azuresre.ai",
            powerState: "Running",
          },
        }),
      });
    });
    await page.route("https://demo.hash.eastus.azuresre.ai/**", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "private installation details" }),
      });
    });

    await page.goto("/install.html?repo=owner/plugin");
    await page.locator("#consent-accept").click();
    await page.locator("#sign-in-btn").click();
    await page.locator("#agent-select").selectOption("0");
    await page.locator("#install-btn").click();

    await expect(page.locator("#online-status")).toContainText(
      "Azure returned: private installation details"
    );
    await expect
      .poll(
        () =>
          envelopes(ingestionRequests).find(
            (envelope) =>
              envelope.data.baseType === "ExceptionData" &&
              envelope.data.baseData.properties.operation === "install-plugin"
          ),
        { timeout: 5000 }
      )
      .toBeTruthy();

    const exception = envelopes(ingestionRequests).find(
      (envelope) =>
        envelope.data.baseType === "ExceptionData" &&
        envelope.data.baseData.properties.operation === "install-plugin"
    );
    expect(exception.data.baseData.properties).toEqual({
      handled: "true",
      operation: "install-plugin",
      status: "500",
    });
    expect(JSON.stringify(exception)).not.toContain("private installation details");
  });

  test("does not report repository copying when clipboard writing fails", async ({ page }) => {
    const ingestionRequests = [];
    await enableTelemetry(page, ingestionRequests);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () => Promise.reject(new Error("Clipboard unavailable")),
        },
      });
    });

    await page.goto("/install.html?repo=owner/repo");
    await page.locator("#consent-accept").click();
    await page.locator("#copy-repo-btn").click();
    await page.waitForTimeout(250);

    expect(
      envelopes(ingestionRequests).some(
        (envelope) => envelope.data.baseData.name === "PluginRepositoryCopied"
      )
    ).toBe(false);
    expect(
      envelopes(ingestionRequests).some(
        (envelope) => envelope.data.baseType === "MetricData"
      )
    ).toBe(false);
    await expect(page.locator("#toast")).not.toHaveClass(/visible/);
  });

  test("reports badge generation and copy events", async ({ page, context }) => {
    const ingestionRequests = [];
    await enableTelemetry(page, ingestionRequests);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    await page.goto("/");
    await page.locator("#consent-accept").click();
    await page.locator("#gen-repo").fill("owner/repo");
    await page.locator("#gen-path").fill("plugins/my-plugin");
    await page.locator("#generator-form button[type=submit]").click();
    await page.locator("#copy-badge-btn").click();

    await expect
      .poll(
        () =>
          envelopes(ingestionRequests)
            .filter((envelope) => envelope.data.baseType === "EventData")
            .map((envelope) => envelope.data.baseData.name),
        { timeout: 5000 }
      )
      .toEqual(expect.arrayContaining(["BadgeGenerated", "BadgeMarkdownCopied"]));

    const badgeGenerated = envelopes(ingestionRequests).find(
      (envelope) => envelope.data.baseData.name === "BadgeGenerated"
    );
    expect(badgeGenerated.data.baseData.properties.hasPath).toBe("true");
  });

  test("does not report a badge copy event when clipboard writing fails", async ({ page }) => {
    const ingestionRequests = [];
    await enableTelemetry(page, ingestionRequests);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () => Promise.reject(new Error("Clipboard unavailable")),
        },
      });
    });

    await page.goto("/");
    await page.locator("#consent-accept").click();
    await page.locator("#gen-repo").fill("owner/repo");
    await page.locator("#generator-form button[type=submit]").click();
    await expect
      .poll(
        () =>
          envelopes(ingestionRequests).some(
            (envelope) => envelope.data.baseData.name === "BadgeGenerated"
          ),
        { timeout: 5000 }
      )
      .toBe(true);

    await page.locator("#copy-badge-btn").click();
    await page.waitForTimeout(250);

    expect(
      envelopes(ingestionRequests).some(
        (envelope) => envelope.data.baseData.name === "BadgeMarkdownCopied"
      )
    ).toBe(false);
    await expect(page.locator("#toast")).not.toHaveClass(/visible/);
  });

  test("does not report a badge copy event when the fallback copy fails", async ({ page }) => {
    const ingestionRequests = [];
    await enableTelemetry(page, ingestionRequests);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
      });
      document.execCommand = () => false;
    });

    await page.goto("/");
    await page.locator("#consent-accept").click();
    await page.locator("#gen-repo").fill("owner/repo");
    await page.locator("#generator-form button[type=submit]").click();
    await page.locator("#copy-badge-btn").click();
    await page.waitForTimeout(250);

    expect(
      envelopes(ingestionRequests).some(
        (envelope) => envelope.data.baseData.name === "BadgeMarkdownCopied"
      )
    ).toBe(false);
    await expect(page.locator("#toast")).not.toHaveClass(/visible/);
  });

  test("collects nothing when the visitor declines", async ({ page }) => {
    const ingestionRequests = [];
    await enableTelemetry(page, ingestionRequests);

    await page.goto("/install.html?repo=owner/repo");
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

    await page.goto("/install.html?repo=owner/repo");
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
    await page.evaluate(() =>
      sessionStorage.setItem(
        "sre-agent-plugin-installer.analytics-consent",
        JSON.stringify({
          version: 2,
          granted: false,
          decidedAt: new Date().toISOString(),
        })
      )
    );

    await page.locator("#consent-change").click();

    await expect(page.locator("#consent-banner")).toBeVisible();
    await expect(page.locator("#consent-status")).toHaveText(
      "Anonymous analytics: awaiting your choice."
    );
    expect(
      await page.evaluate(() => ({
        local: JSON.parse(
          localStorage.getItem("sre-agent-plugin-installer.analytics-consent")
        ),
        session: sessionStorage.getItem(
          "sre-agent-plugin-installer.analytics-consent"
        ),
      }))
    ).toEqual({
      local: expect.objectContaining({ version: 2, reset: true }),
      session: null,
    });
  });

  test("stops analytics in another open tab after consent is withdrawn", async ({
    page,
    context,
  }) => {
    const ingestionRequests = [];
    await enableTelemetry(page, ingestionRequests);
    await page.goto("/");
    await page.locator("#consent-accept").click();

    const otherPage = await context.newPage();
    await enableTelemetry(otherPage, ingestionRequests);
    await otherPage.goto("/");
    await expect(otherPage.locator("#consent-status")).toHaveText(
      "Anonymous analytics: on."
    );
    await otherPage.evaluate(() => {
      const consentKey = "sre-agent-plugin-installer.analytics-consent";
      const setItem = Storage.prototype.setItem;
      const removeItem = Storage.prototype.removeItem;
      Storage.prototype.setItem = function (key, value) {
        if (this === localStorage && key === consentKey) {
          throw new DOMException("Local storage write failed");
        }
        return setItem.call(this, key, value);
      };
      Storage.prototype.removeItem = function (key) {
        if (this === localStorage && key === consentKey) {
          throw new DOMException("Local storage removal failed");
        }
        return removeItem.call(this, key);
      };
    });

    await otherPage.locator("#consent-change").click();
    await otherPage.reload();
    await expect(otherPage.locator("#consent-status")).toHaveText(
      "Anonymous analytics: awaiting your choice."
    );
    await otherPage.locator("#consent-decline").click();

    await expect(page.locator("#consent-status")).toHaveText(
      "Anonymous analytics: off."
    );
    expect(await page.evaluate(() => window.siteTelemetry.isEnabled())).toBe(false);
  });
});
