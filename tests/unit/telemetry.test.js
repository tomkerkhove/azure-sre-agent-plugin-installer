const fs = require("fs");
const path = require("path");
const vm = require("vm");

const TELEMETRY_SOURCE = fs.readFileSync(
  path.join(__dirname, "../../assets/telemetry.js"),
  "utf8"
);

const VALID_CONNECTION_STRING =
  "InstrumentationKey=11111111-2222-3333-4444-555555555555;" +
  "IngestionEndpoint=https://westeurope-1.in.applicationinsights.azure.com/";

function createStorage() {
  const entries = new Map();
  return {
    setItem: (key, value) => entries.set(key, String(value)),
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    removeItem: (key) => entries.delete(key),
    size: () => entries.size,
  };
}

function createBroadcastChannelClass() {
  const channels = [];
  class BroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      channels.push(this);
    }

    postMessage(data) {
      for (const channel of channels) {
        if (
          channel !== this &&
          channel.name === this.name &&
          typeof channel.onmessage === "function"
        ) {
          channel.onmessage({ data });
        }
      }
    }
  }
  BroadcastChannel.channels = channels;
  return BroadcastChannel;
}

// Minimal browser-like harness: telemetry.js is an IIFE meant for the browser,
// so it is evaluated in a sandbox with just the globals it touches.
function loadTelemetry(connectionString, options = {}) {
  const requests = [];
  const listeners = {};
  const localStorage =
    options.localStorage === undefined ? createStorage() : options.localStorage;
  const sessionStorage =
    options.sessionStorage === undefined ? createStorage() : options.sessionStorage;

  const sandbox = {
    console,
    crypto: options.crypto === undefined ? require("crypto").webcrypto : options.crypto,
    Math,
    Number,
    isFinite,
    Date,
    Intl: {
      DateTimeFormat: (locales, formatterOptions) => {
        if (formatterOptions && formatterOptions.timeZone !== undefined) {
          return Intl.DateTimeFormat(locales, formatterOptions);
        }
        return {
          resolvedOptions: () => {
            if (options.timeZoneError) {
              throw new Error("Time zone unavailable");
            }
            return {
              timeZone:
                options.timeZone === undefined ? "Europe/Brussels" : options.timeZone,
            };
          },
        };
      },
    },
    JSON,
    Object,
    String,
    Uint8Array,
    URL,
    Blob: class Blob {
      constructor(parts, init) {
        this.parts = parts;
        this.type = init && init.type;
      }
    },
    fetch: (url, init) => {
      requests.push({ url, body: init.body, headers: init.headers });
      return Promise.resolve();
    },
    navigator: {},
    addEventListener: (name, handler) => {
      listeners[name] = handler;
    },
    document: {
      title: "Install to Azure SRE Agent",
      addEventListener: (name, handler) => {
        listeners[name] = handler;
      },
      getElementById: () => null,
    },
    localStorage,
    sessionStorage,
    BroadcastChannel: options.BroadcastChannel,
  };
  sandbox.window = sandbox;

  if (connectionString !== undefined) {
    sandbox.window.SITE_CONFIG = { telemetry: { connectionString } };
  }

  vm.createContext(sandbox);
  vm.runInContext(TELEMETRY_SOURCE, sandbox);

  return {
    telemetry: sandbox.window.siteTelemetry,
    requests,
    localStorage,
    sessionStorage,
    listeners,
    envelopes: () => requests.map((request) => JSON.parse(request.body)[0]),
  };
}

describe("telemetry configuration", () => {
  test("is disabled when no connection string is configured", () => {
    const { telemetry } = loadTelemetry("");
    expect(telemetry.isConfigured()).toBe(false);
    expect(telemetry.isEnabled()).toBe(false);
  });

  test("is disabled when SITE_CONFIG is missing entirely", () => {
    const { telemetry } = loadTelemetry(undefined);
    expect(telemetry.isConfigured()).toBe(false);
  });

  test("is configured for a valid connection string", () => {
    const { telemetry } = loadTelemetry(VALID_CONNECTION_STRING);
    expect(telemetry.isConfigured()).toBe(true);
  });

  test("rejects a malformed instrumentation key", () => {
    const { telemetry } = loadTelemetry(
      "InstrumentationKey=not-a-guid;IngestionEndpoint=https://x.monitor.azure.com/"
    );
    expect(telemetry.isConfigured()).toBe(false);
  });

  test("rejects a non-Azure ingestion endpoint", () => {
    const { telemetry } = loadTelemetry(
      "InstrumentationKey=11111111-2222-3333-4444-555555555555;" +
        "IngestionEndpoint=https://evil.applicationinsights.azure.com.attacker.example/"
    );
    expect(telemetry.isConfigured()).toBe(false);
  });

  test("rejects a look-alike host without a dot separator", () => {
    const { telemetry } = loadTelemetry(
      "InstrumentationKey=11111111-2222-3333-4444-555555555555;" +
        "IngestionEndpoint=https://attackerapplicationinsights.azure.com/"
    );
    expect(telemetry.isConfigured()).toBe(false);
  });

  test("rejects a plaintext ingestion endpoint", () => {
    const { telemetry } = loadTelemetry(
      "InstrumentationKey=11111111-2222-3333-4444-555555555555;" +
        "IngestionEndpoint=http://westeurope-1.in.applicationinsights.azure.com/"
    );
    expect(telemetry.isConfigured()).toBe(false);
  });

  test("falls back to the classic ingestion endpoint", () => {
    const { telemetry, requests } = loadTelemetry(
      "InstrumentationKey=11111111-2222-3333-4444-555555555555"
    );
    expect(telemetry.isConfigured()).toBe(true);
    telemetry.setConsent(true);
    telemetry.trackEvent("Test");
    expect(requests[0].url).toBe("https://dc.services.visualstudio.com/v2/track");
  });
});

describe("consent gating", () => {
  test("sends nothing before consent is given", () => {
    const { telemetry, requests } = loadTelemetry(VALID_CONNECTION_STRING);
    telemetry.trackEvent("BadgeGenerated");
    telemetry.trackException(new Error("private error details"));
    telemetry.trackPageView({ scenario: "badge-generator" });
    telemetry.trackMetric("PluginInstalls", 1, { repository: "owner/repo" });
    expect(telemetry.isEnabled()).toBe(false);
    expect(requests).toHaveLength(0);
  });

  test("sends telemetry once consent is granted", () => {
    const { telemetry, requests } = loadTelemetry(VALID_CONNECTION_STRING);
    telemetry.setConsent(true);
    telemetry.trackEvent("BadgeGenerated");
    expect(telemetry.isEnabled()).toBe(true);
    expect(requests).toHaveLength(1);
  });

  test("sends nothing after consent is declined", () => {
    const { telemetry, requests } = loadTelemetry(VALID_CONNECTION_STRING);
    telemetry.setConsent(false);
    telemetry.trackEvent("BadgeGenerated");
    expect(requests).toHaveLength(0);
  });

  test("stops sending when consent is withdrawn", () => {
    const { telemetry, requests } = loadTelemetry(VALID_CONNECTION_STRING);
    telemetry.setConsent(true);
    telemetry.trackEvent("First");
    telemetry.setConsent(false);
    telemetry.trackEvent("Second");
    expect(requests).toHaveLength(1);
  });

  test("stops sending when consent is withdrawn in another tab", () => {
    const localStorage = createStorage();
    localStorage.setItem(
      "sre-agent-plugin-installer.analytics-consent",
      JSON.stringify({
        version: 2,
        granted: true,
        decidedAt: "2026-01-01T00:00:00.000Z",
      })
    );
    const { telemetry, requests, listeners } = loadTelemetry(
      VALID_CONNECTION_STRING,
      { localStorage }
    );
    telemetry.trackEvent("BeforeWithdrawal");

    localStorage.setItem(
      "sre-agent-plugin-installer.analytics-consent",
      JSON.stringify({
        version: 2,
        granted: false,
        decidedAt: "2026-01-02T00:00:00.000Z",
      })
    );
    listeners.storage({
      key: "sre-agent-plugin-installer.analytics-consent",
      storageArea: localStorage,
    });
    telemetry.trackEvent("AfterWithdrawal");

    expect(telemetry.isEnabled()).toBe(false);
    expect(requests).toHaveLength(1);
  });

  test("broadcasts a session-fallback withdrawal to another tab", () => {
    const backingStorage = createStorage();
    backingStorage.setItem(
      "sre-agent-plugin-installer.analytics-consent",
      JSON.stringify({
        version: 2,
        granted: true,
        decidedAt: "2026-01-01T00:00:00.000Z",
      })
    );
    const localStorage = {
      getItem: backingStorage.getItem,
      removeItem: (key) => {
        if (key === "__probe__") {
          backingStorage.removeItem(key);
          return;
        }
        throw new Error("Local storage removal failed");
      },
      setItem: (key, value) => {
        if (key === "__probe__") {
          backingStorage.setItem(key, value);
          return;
        }
        throw new Error("Local storage write failed");
      },
    };
    const BroadcastChannel = createBroadcastChannelClass();
    const secondSessionStorage = createStorage();
    const first = loadTelemetry(VALID_CONNECTION_STRING, {
      BroadcastChannel,
      localStorage,
      sessionStorage: createStorage(),
    });
    const second = loadTelemetry(VALID_CONNECTION_STRING, {
      BroadcastChannel,
      localStorage,
      sessionStorage: secondSessionStorage,
    });
    second.telemetry.trackEvent("BeforeWithdrawal");

    first.telemetry.setConsent(false);
    second.telemetry.trackEvent("AfterWithdrawal");

    expect(first.telemetry.isEnabled()).toBe(false);
    expect(second.telemetry.isEnabled()).toBe(false);
    expect(second.requests).toHaveLength(1);

    BroadcastChannel.channels[1].onmessage({
      data: {
        version: 2,
        consent: "granted",
        decidedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(second.telemetry.isEnabled()).toBe(false);

    const reloadedSecond = loadTelemetry(VALID_CONNECTION_STRING, {
      BroadcastChannel,
      localStorage,
      sessionStorage: secondSessionStorage,
    });
    expect(reloadedSecond.telemetry.isEnabled()).toBe(false);
  });

  test("clears the session identifier when consent is withdrawn", () => {
    const { telemetry, sessionStorage } = loadTelemetry(VALID_CONNECTION_STRING);
    telemetry.setConsent(true);
    telemetry.trackEvent("First");
    expect(sessionStorage.getItem("sre-agent-plugin-installer.session-id")).not.toBeNull();
    telemetry.setConsent(false);
    expect(sessionStorage.getItem("sre-agent-plugin-installer.session-id")).toBeNull();
  });

  test("remembers the decision across page loads", () => {
    const localStorage = createStorage();
    const first = loadTelemetry(VALID_CONNECTION_STRING, { localStorage });
    first.telemetry.setConsent(true);

    const second = loadTelemetry(VALID_CONNECTION_STRING, { localStorage });
    second.telemetry.trackEvent("BadgeGenerated");
    expect(second.telemetry.isEnabled()).toBe(true);
    expect(second.requests).toHaveLength(1);
  });

  test("requires renewed consent when the collected telemetry purpose changes", () => {
    const localStorage = createStorage();
    localStorage.setItem(
      "sre-agent-plugin-installer.analytics-consent",
      JSON.stringify({ version: 1, granted: true })
    );

    const { telemetry, requests } = loadTelemetry(VALID_CONNECTION_STRING, {
      localStorage,
    });
    telemetry.trackException(new Error("private"));

    expect(telemetry.isEnabled()).toBe(false);
    expect(requests).toHaveLength(0);
  });

  test("requires renewed consent outside Europe for every outdated choice", () => {
    for (const granted of [true, false]) {
      const localStorage = createStorage();
      localStorage.setItem(
        "sre-agent-plugin-installer.analytics-consent",
        JSON.stringify({ version: 1, granted })
      );

      const { telemetry, requests } = loadTelemetry(VALID_CONNECTION_STRING, {
        localStorage,
        timeZone: "America/New_York",
      });
      telemetry.trackEvent("BadgeGenerated");

      expect(telemetry.isEnabled()).toBe(false);
      expect(requests).toHaveLength(0);
    }
  });

  test("requires renewed consent for an empty stored preference", () => {
    const localStorage = createStorage();
    localStorage.setItem("sre-agent-plugin-installer.analytics-consent", "");

    const { telemetry } = loadTelemetry(VALID_CONNECTION_STRING, {
      localStorage,
      timeZone: "America/New_York",
    });

    expect(telemetry.isEnabled()).toBe(false);
  });

  test("honors a newer session reset when stale local consent cannot be removed", () => {
    const localStorage = createStorage();
    const sessionStorage = createStorage();
    localStorage.setItem(
      "sre-agent-plugin-installer.analytics-consent",
      JSON.stringify({
        version: 2,
        granted: true,
        decidedAt: "2026-01-01T00:00:00.000Z",
      })
    );
    sessionStorage.setItem(
      "sre-agent-plugin-installer.analytics-consent",
      JSON.stringify({
        version: 2,
        reset: true,
        decidedAt: "2026-01-02T00:00:00.000Z",
      })
    );

    const { telemetry } = loadTelemetry(VALID_CONNECTION_STRING, {
      localStorage,
      sessionStorage,
      timeZone: "America/New_York",
    });

    expect(telemetry.isEnabled()).toBe(false);
  });

  test("does not store any cookie-like consent value when analytics are declined", () => {
    const localStorage = createStorage();
    const declined = loadTelemetry(VALID_CONNECTION_STRING, { localStorage });
    declined.telemetry.setConsent(false);

    const reloaded = loadTelemetry(VALID_CONNECTION_STRING, { localStorage });
    reloaded.telemetry.trackEvent("BadgeGenerated");
    expect(reloaded.telemetry.isEnabled()).toBe(false);
    expect(reloaded.requests).toHaveLength(0);
  });

  test("queues a page view until consent is granted", () => {
    const { telemetry, requests, envelopes } = loadTelemetry(VALID_CONNECTION_STRING);
    telemetry.trackPageView({ scenario: "plugin-install" });
    expect(requests).toHaveLength(0);

    telemetry.setConsent(true);
    expect(requests).toHaveLength(1);
    expect(envelopes()[0].data.baseType).toBe("PageviewData");
  });
});

describe("regional consent", () => {
  test("automatically enables analytics outside Europe", () => {
    const { telemetry, requests, localStorage } = loadTelemetry(
      VALID_CONNECTION_STRING,
      { timeZone: "America/New_York" }
    );

    telemetry.trackEvent("BadgeGenerated");

    expect(telemetry.isEnabled()).toBe(true);
    expect(requests).toHaveLength(1);
    expect(localStorage.getItem("sre-agent-plugin-installer.analytics-consent")).toBeNull();
  });

  test("requires consent for European time zones", () => {
    const { telemetry, requests } = loadTelemetry(VALID_CONNECTION_STRING, {
      timeZone: "Europe/Brussels",
    });

    telemetry.trackEvent("BadgeGenerated");

    expect(telemetry.isEnabled()).toBe(false);
    expect(requests).toHaveLength(0);
  });

  test("requires consent for the canonical Faroe Islands time zone", () => {
    const { telemetry } = loadTelemetry(VALID_CONNECTION_STRING, {
      timeZone: "Atlantic/Faeroe",
    });
    expect(telemetry.isEnabled()).toBe(false);
  });

  test("requires consent for EU outermost-region time zones", () => {
    for (const timeZone of [
      "America/Cayenne",
      "America/Guadeloupe",
      "America/Marigot",
      "America/Martinique",
      "Indian/Mayotte",
      "Indian/Reunion",
    ]) {
      const { telemetry } = loadTelemetry(VALID_CONNECTION_STRING, {
        timeZone,
      });
      expect(telemetry.isEnabled()).toBe(false);
    }
  });

  test("requires consent when the time zone does not identify a region", () => {
    const { telemetry } = loadTelemetry(VALID_CONNECTION_STRING, {
      timeZone: "UTC",
    });
    expect(telemetry.isEnabled()).toBe(false);
  });

  test("requires consent for fixed-offset time zones", () => {
    for (const timeZone of ["+01:00", "+23", "-2359"]) {
      const { telemetry } = loadTelemetry(VALID_CONNECTION_STRING, {
        timeZone,
      });
      expect(telemetry.isEnabled()).toBe(false);
    }
  });

  test("requires consent for GMT and Etc time zones", () => {
    for (const timeZone of ["GMT", "Etc/GMT", "Etc/GMT+1"]) {
      const { telemetry } = loadTelemetry(VALID_CONNECTION_STRING, {
        timeZone,
      });
      expect(telemetry.isEnabled()).toBe(false);
    }
  });

  test("requires consent for European aliases and malformed identifiers", () => {
    for (const timeZone of ["CET", "EET", "WET", "GB", "Turkey", "invalid"]) {
      const { telemetry } = loadTelemetry(VALID_CONNECTION_STRING, {
        timeZone,
      });
      expect(telemetry.isEnabled()).toBe(false);
    }
  });

  test("requires consent for malformed identifiers with a known regional prefix", () => {
    const { telemetry } = loadTelemetry(VALID_CONNECTION_STRING, {
      timeZone: "America/not-a-real-zone",
    });
    expect(telemetry.isEnabled()).toBe(false);
  });

  test("recognizes non-European legacy aliases", () => {
    for (const timeZone of [
      "US/Eastern",
      "Canada/Pacific",
      "Japan",
      "CST6CDT",
      "EST5EDT",
      "HST",
      "MST7MDT",
      "PST8PDT",
    ]) {
      const { telemetry } = loadTelemetry(VALID_CONNECTION_STRING, {
        timeZone,
      });
      expect(telemetry.isEnabled()).toBe(true);
    }
  });

  test("requires consent when time zone detection fails", () => {
    const { telemetry } = loadTelemetry(VALID_CONNECTION_STRING, {
      timeZoneError: true,
    });
    expect(telemetry.isEnabled()).toBe(false);
  });

  test("requires consent when the time zone is missing", () => {
    const { telemetry } = loadTelemetry(VALID_CONNECTION_STRING, {
      timeZone: null,
    });
    expect(telemetry.isEnabled()).toBe(false);
  });

  test("preserves an explicit decline outside Europe", () => {
    const localStorage = createStorage();
    localStorage.setItem(
      "sre-agent-plugin-installer.analytics-consent",
      JSON.stringify({ version: 2, granted: false })
    );

    const { telemetry } = loadTelemetry(VALID_CONNECTION_STRING, {
      localStorage,
      timeZone: "America/New_York",
    });

    expect(telemetry.isEnabled()).toBe(false);
  });

  test("falls back to session storage when local storage is unavailable", () => {
    const sessionStorage = createStorage();
    const first = loadTelemetry(VALID_CONNECTION_STRING, {
      localStorage: null,
      sessionStorage,
      timeZone: "America/New_York",
    });
    first.telemetry.setConsent(false);
    expect(
      JSON.parse(
        sessionStorage.getItem("sre-agent-plugin-installer.analytics-consent")
      ).granted
    ).toBe(false);

    const second = loadTelemetry(VALID_CONNECTION_STRING, {
      localStorage: null,
      sessionStorage,
      timeZone: "America/New_York",
    });

    expect(second.telemetry.isEnabled()).toBe(false);
  });

  test("reads consent from session storage when local storage fails after probing", () => {
    const localStorage = createStorage();
    localStorage.getItem = () => {
      throw new Error("Local storage read failed");
    };
    const sessionStorage = createStorage();
    sessionStorage.setItem(
      "sre-agent-plugin-installer.analytics-consent",
      JSON.stringify({ version: 2, granted: false })
    );

    const { telemetry } = loadTelemetry(VALID_CONNECTION_STRING, {
      localStorage,
      sessionStorage,
      timeZone: "America/New_York",
    });

    expect(telemetry.isEnabled()).toBe(false);
  });

  test("requires consent when a preference read fails without a fallback choice", () => {
    const localStorage = createStorage();
    localStorage.getItem = () => {
      throw new Error("Local storage read failed");
    };

    const { telemetry } = loadTelemetry(VALID_CONNECTION_STRING, {
      localStorage,
      timeZone: "America/New_York",
    });

    expect(telemetry.isEnabled()).toBe(false);
  });

  test("writes consent to session storage when local storage fails after probing", () => {
    const backingStorage = createStorage();
    const localStorage = {
      getItem: backingStorage.getItem,
      removeItem: backingStorage.removeItem,
      setItem: (key, value) => {
        if (key === "__probe__") {
          backingStorage.setItem(key, value);
          return;
        }
        throw new Error("Local storage write failed");
      },
    };
    const sessionStorage = createStorage();
    const first = loadTelemetry(VALID_CONNECTION_STRING, {
      localStorage,
      sessionStorage,
      timeZone: "America/New_York",
    });
    first.telemetry.setConsent(false);
    expect(
      JSON.parse(
        sessionStorage.getItem("sre-agent-plugin-installer.analytics-consent")
      ).granted
    ).toBe(false);

    const second = loadTelemetry(VALID_CONNECTION_STRING, {
      localStorage,
      sessionStorage,
      timeZone: "America/New_York",
    });

    expect(second.telemetry.isEnabled()).toBe(false);
  });

  test("prefers a newer session fallback choice over stale local consent", () => {
    const backingStorage = createStorage();
    backingStorage.setItem(
      "sre-agent-plugin-installer.analytics-consent",
      JSON.stringify({
        version: 2,
        granted: true,
        decidedAt: "2026-01-01T00:00:00.000Z",
      })
    );
    const localStorage = {
      getItem: backingStorage.getItem,
      removeItem: (key) => {
        if (key === "__probe__") {
          backingStorage.removeItem(key);
          return;
        }
        throw new Error("Local storage removal failed");
      },
      setItem: (key, value) => {
        if (key === "__probe__") {
          backingStorage.setItem(key, value);
          return;
        }
        throw new Error("Local storage write failed");
      },
    };
    const sessionStorage = createStorage();
    const first = loadTelemetry(VALID_CONNECTION_STRING, {
      localStorage,
      sessionStorage,
      timeZone: "America/New_York",
    });
    expect(first.telemetry.isEnabled()).toBe(true);

    first.telemetry.setConsent(false);
    expect(
      JSON.parse(
        sessionStorage.getItem("sre-agent-plugin-installer.analytics-consent")
      ).granted
    ).toBe(false);
    const second = loadTelemetry(VALID_CONNECTION_STRING, {
      localStorage,
      sessionStorage,
      timeZone: "America/New_York",
    });

    expect(second.telemetry.isEnabled()).toBe(false);
  });

  test("requires consent when no preference storage is available", () => {
    const { telemetry } = loadTelemetry(VALID_CONNECTION_STRING, {
      localStorage: null,
      sessionStorage: null,
      timeZone: "America/New_York",
    });
    expect(telemetry.isEnabled()).toBe(false);
  });

  test("requires consent when readable storage rejects consent writes", () => {
    const backingStorage = createStorage();
    const localStorage = {
      getItem: backingStorage.getItem,
      removeItem: backingStorage.removeItem,
      setItem: (key, value) => {
        if (key !== "__probe__") {
          throw new Error("Storage became read-only");
        }
        backingStorage.setItem(key, value);
      },
    };

    const { telemetry } = loadTelemetry(VALID_CONNECTION_STRING, {
      localStorage,
      sessionStorage: null,
      timeZone: "America/New_York",
    });

    expect(telemetry.isEnabled()).toBe(false);
  });
});

describe("exception telemetry", () => {
  test("sends an Application Insights exception without messages or stack traces", () => {
    const { telemetry, requests, envelopes } = loadTelemetry(VALID_CONNECTION_STRING);
    const error = new TypeError("token=private-value");
    error.stack = "private stack trace";

    telemetry.setConsent(true);
    telemetry.trackException(error, { handled: true, operation: "install-plugin" });

    const envelope = envelopes()[0];
    expect(envelope.name).toBe(
      "Microsoft.ApplicationInsights.11111111222233334444555555555555.Exception"
    );
    expect(envelope.data.baseType).toBe("ExceptionData");
    expect(envelope.data.baseData.exceptions).toEqual([
      {
        id: 1,
        outerId: 0,
        typeName: "TypeError",
        message: "An application exception occurred.",
        hasFullStack: false,
        stack: "Stack trace omitted for privacy.",
        parsedStack: [],
      },
    ]);
    expect(envelope.data.baseData.properties).toEqual({
      handled: "true",
      operation: "install-plugin",
    });
    expect(requests[0].body).not.toContain("private-value");
    expect(requests[0].body).not.toContain("private stack trace");
  });

  test("normalizes custom exception names rather than sending arbitrary text", () => {
    const { telemetry, envelopes } = loadTelemetry(VALID_CONNECTION_STRING);
    telemetry.setConsent(true);
    telemetry.trackException({ name: "CustomerAccount123", message: "private" });

    expect(envelopes()[0].data.baseData.exceptions[0].typeName).toBe("Error");
  });

  test("only sends allowlisted exception context and values", () => {
    const { telemetry, envelopes } = loadTelemetry(VALID_CONNECTION_STRING);
    telemetry.setConsent(true);
    telemetry.trackException(new Error("private"), {
      handled: "yes",
      operation: "account=private",
      source: "https://private.example/path",
      status: 999,
      secret: "private-value",
    });

    expect(envelopes()[0].data.baseData.properties).toEqual({});
  });

  test("sends a valid API status with handled operation context", () => {
    const { telemetry, envelopes } = loadTelemetry(VALID_CONNECTION_STRING);
    telemetry.setConsent(true);
    telemetry.trackException(new Error("private"), {
      handled: true,
      operation: "list-agents",
      status: 503,
    });

    expect(envelopes()[0].data.baseData.properties).toEqual({
      handled: "true",
      operation: "list-agents",
      status: "503",
    });
  });

  test("captures unhandled errors and promise rejections after consent", () => {
    const { telemetry, listeners, envelopes } = loadTelemetry(VALID_CONNECTION_STRING);
    telemetry.setConsent(true);

    listeners.error({ error: new ReferenceError("private error") });
    listeners.unhandledrejection({ reason: new RangeError("private rejection") });

    expect(envelopes()).toHaveLength(2);
    expect(envelopes()[0].data.baseData.exceptions[0].typeName).toBe("ReferenceError");
    expect(envelopes()[0].data.baseData.properties).toEqual({
      handled: "false",
      source: "window-error",
    });
    expect(envelopes()[1].data.baseData.exceptions[0].typeName).toBe("RangeError");
    expect(envelopes()[1].data.baseData.properties.source).toBe("unhandled-rejection");
  });
});

describe("plugin install metric", () => {
  test("reports the repository as a metric dimension", () => {
    const { telemetry, envelopes } = loadTelemetry(VALID_CONNECTION_STRING);
    telemetry.setConsent(true);
    telemetry.trackMetric("PluginInstalls", 1, { repository: "owner/repo" });

    const envelope = envelopes()[0];
    expect(envelope.name).toBe(
      "Microsoft.ApplicationInsights.11111111222233334444555555555555.Metric"
    );
    expect(envelope.data.baseType).toBe("MetricData");
    expect(envelope.data.baseData.metrics).toEqual([
      { name: "PluginInstalls", kind: 0, value: 1 },
    ]);
    expect(envelope.data.baseData.properties.repository).toBe("owner/repo");
  });

  test("ignores metrics without a name or with a non-numeric value", () => {
    const { telemetry, requests } = loadTelemetry(VALID_CONNECTION_STRING);
    telemetry.setConsent(true);
    telemetry.trackMetric("", 1);
    telemetry.trackMetric("PluginInstalls", Number.NaN);
    telemetry.trackMetric("PluginInstalls", "not-a-number");
    expect(requests).toHaveLength(0);
  });
});

describe("payload hygiene", () => {
  test("sends a CORS-simple content type", () => {
    const { telemetry, requests } = loadTelemetry(VALID_CONNECTION_STRING);
    telemetry.setConsent(true);
    telemetry.trackEvent("BadgeGenerated");
    expect(requests[0].headers["Content-Type"]).toBe("text/plain;charset=UTF-8");
  });

  test("truncates long property values and caps the number of properties", () => {
    const { telemetry, envelopes } = loadTelemetry(VALID_CONNECTION_STRING);
    telemetry.setConsent(true);

    const properties = { long: "x".repeat(500) };
    for (let index = 0; index < 20; index += 1) {
      properties["key" + index] = index;
    }
    telemetry.trackEvent("BadgeGenerated", properties);

    const sent = envelopes()[0].data.baseData.properties;
    expect(Object.keys(sent).length).toBeLessThanOrEqual(12);
    if (sent.long) {
      expect(sent.long).toHaveLength(256);
    }
  });

  test("drops nested objects so no unexpected payload is leaked", () => {
    const { telemetry, envelopes } = loadTelemetry(VALID_CONNECTION_STRING);
    telemetry.setConsent(true);
    telemetry.trackEvent("BadgeGenerated", {
      repository: "owner/repo",
      nested: { secret: "value" },
    });

    const sent = envelopes()[0].data.baseData.properties;
    expect(sent).toEqual({ repository: "owner/repo" });
  });

  test("never includes the raw connection string in the payload", () => {
    const { telemetry, requests } = loadTelemetry(VALID_CONNECTION_STRING);
    telemetry.setConsent(true);
    telemetry.trackEvent("BadgeGenerated", { repository: "owner/repo" });
    expect(requests[0].body).not.toContain("InstrumentationKey=");
  });

  test("groups events of a visit under one session and operation", () => {
    const { telemetry, envelopes } = loadTelemetry(VALID_CONNECTION_STRING);
    telemetry.setConsent(true);
    telemetry.trackEvent("First");
    telemetry.trackEvent("Second");

    const [first, second] = envelopes();
    expect(first.tags["ai.session.id"]).toBe(second.tags["ai.session.id"]);
    expect(first.tags["ai.operation.id"]).toBe(second.tags["ai.operation.id"]);
    expect(first.tags["ai.cloud.role"]).toBe("sre-agent-plugin-installer");
  });

  test("still generates identifiers when crypto is unavailable", () => {
    const { telemetry, envelopes } = loadTelemetry(VALID_CONNECTION_STRING, {
      crypto: undefined,
    });
    telemetry.setConsent(true);
    telemetry.trackEvent("BadgeGenerated");
    expect(envelopes()[0].tags["ai.session.id"]).not.toBe("");
  });
});
