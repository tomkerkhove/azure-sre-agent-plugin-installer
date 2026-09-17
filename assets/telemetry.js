// Cookieless, consent-gated Azure Application Insights telemetry.
//
// Design goals (see PRIVACY.md):
//   * No telemetry at all until the visitor explicitly opts in.
//   * No cookies, no fingerprinting, no personal data and no free-text input.
//   * No third-party script: events are posted directly to the Application
//     Insights ingestion REST API so the page can keep a strict CSP.
//   * The only credential used is the write-only ingestion connection string,
//     which is the only credential that can safely live in a browser. Managed
//     identity/Entra ID tokens are deliberately *not* used, because any token
//     shipped to a browser would be readable by every visitor.

(function () {
  "use strict";

  var CONSENT_STORAGE_KEY = "sre-agent-plugin-installer.analytics-consent";
  var CONSENT_VERSION = 1;
  var MAX_PROPERTIES = 12;
  var MAX_PROPERTY_LENGTH = 256;
  var SAFE_EXCEPTION_TYPES = [
    "Error",
    "EvalError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "TypeError",
    "URIError",
    "AggregateError",
    "ApiError",
  ];

  // Application Insights ingestion is only accepted on these Azure Monitor
  // domains. Validating this guards against a misconfigured or tampered
  // connection string redirecting telemetry to an attacker-controlled host.
  var ALLOWED_ENDPOINT_SUFFIXES = [
    ".applicationinsights.azure.com",
    ".applicationinsights.azure.cn",
    ".applicationinsights.azure.us",
    ".monitor.azure.com",
    ".monitor.azure.cn",
    ".monitor.azure.us",
  ];

  var GUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function safeStorage(storage) {
    try {
      var probe = "__probe__";
      storage.setItem(probe, "1");
      storage.removeItem(probe);
      return storage;
    } catch (error) {
      return null;
    }
  }

  var localStore = safeStorage(window.localStorage);
  var sessionStore = safeStorage(window.sessionStorage);

  function readConsent() {
    if (!localStore) return null;
    try {
      var raw = localStore.getItem(CONSENT_STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== CONSENT_VERSION) return null;
      return parsed.granted === true ? "granted" : "denied";
    } catch (error) {
      return null;
    }
  }

  function writeConsent(granted) {
    if (!localStore) return;
    try {
      localStore.setItem(
        CONSENT_STORAGE_KEY,
        JSON.stringify({
          version: CONSENT_VERSION,
          granted: granted,
          decidedAt: new Date().toISOString(),
        })
      );
    } catch (error) {
      /* Consent simply is not remembered when storage is unavailable. */
    }
  }

  function parseConnectionString(connectionString) {
    if (typeof connectionString !== "string" || !connectionString.trim()) {
      return null;
    }

    var parts = connectionString.split(";");
    var values = {};
    for (var i = 0; i < parts.length; i++) {
      var separator = parts[i].indexOf("=");
      if (separator <= 0) continue;
      var key = parts[i].slice(0, separator).trim().toLowerCase();
      values[key] = parts[i].slice(separator + 1).trim();
    }

    var instrumentationKey = values.instrumentationkey;
    if (!instrumentationKey || !GUID_PATTERN.test(instrumentationKey)) {
      return null;
    }

    var endpoint = values.ingestionendpoint || "https://dc.services.visualstudio.com/";
    var url;
    try {
      url = new URL(endpoint);
    } catch (error) {
      return null;
    }

    if (url.protocol !== "https:") return null;

    var host = url.hostname.toLowerCase();
    var allowed = host === "dc.services.visualstudio.com";
    for (var j = 0; j < ALLOWED_ENDPOINT_SUFFIXES.length && !allowed; j++) {
      if (
        host.length > ALLOWED_ENDPOINT_SUFFIXES[j].length &&
        host.slice(-ALLOWED_ENDPOINT_SUFFIXES[j].length) ===
          ALLOWED_ENDPOINT_SUFFIXES[j]
      ) {
        allowed = true;
      }
    }
    if (!allowed) return null;

    var base = url.origin + url.pathname;
    if (base.charAt(base.length - 1) !== "/") {
      base += "/";
    }

    return {
      instrumentationKey: instrumentationKey,
      trackUrl: base + "v2/track",
    };
  }

  function randomId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID().replace(/-/g, "");
      }
      if (window.crypto && typeof window.crypto.getRandomValues === "function") {
        var bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        var hex = "";
        for (var i = 0; i < bytes.length; i++) {
          hex += ("0" + bytes[i].toString(16)).slice(-2);
        }
        return hex;
      }
    } catch (error) {
      /* fall through */
    }
    // Last-resort fallback: only used to group the events of a single visit,
    // never for anything security-sensitive.
    var fallback = "";
    for (var j = 0; j < 4; j++) {
      fallback += ("00000000" + Math.floor(Math.random() * 0x100000000).toString(16)).slice(-8);
    }
    return fallback;
  }

  // A per-tab, randomly generated identifier. It is not a cookie, is never
  // persisted across browser sessions and cannot be correlated to a person.
  function sessionId() {
    var key = "sre-agent-plugin-installer.session-id";
    if (!sessionStore) return randomId();
    try {
      var existing = sessionStore.getItem(key);
      if (existing) return existing;
      var created = randomId();
      sessionStore.setItem(key, created);
      return created;
    } catch (error) {
      return randomId();
    }
  }

  function sanitizeProperties(properties) {
    var result = {};
    if (!properties || typeof properties !== "object") return result;

    var keys = Object.keys(properties);
    for (var i = 0; i < keys.length && i < MAX_PROPERTIES; i++) {
      var value = properties[keys[i]];
      if (value === undefined || value === null) continue;
      if (typeof value === "object") continue;
      result[keys[i]] = String(value).slice(0, MAX_PROPERTY_LENGTH);
    }
    return result;
  }

  var config = (window.SITE_CONFIG && window.SITE_CONFIG.telemetry) || {};
  var endpoint = parseConnectionString(config.connectionString);
  var cloudRole = config.cloudRole || "sre-agent-plugin-installer";
  var consent = readConsent();
  var operationId = "";

  function configured() {
    return endpoint !== null;
  }

  function enabled() {
    return configured() && consent === "granted";
  }

  function envelopeSuffix(baseType) {
    if (baseType === "PageviewData") return "Pageview";
    if (baseType === "MetricData") return "Metric";
    if (baseType === "ExceptionData") return "Exception";
    return "Event";
  }

  function send(baseType, baseData) {
    if (!enabled()) return;

    if (!operationId) {
      operationId = randomId();
    }

    var envelope = {
      name:
        "Microsoft.ApplicationInsights." +
        endpoint.instrumentationKey.replace(/-/g, "") +
        "." +
        envelopeSuffix(baseType),
      time: new Date().toISOString(),
      iKey: endpoint.instrumentationKey,
      tags: {
        "ai.cloud.role": cloudRole,
        "ai.operation.id": operationId,
        "ai.session.id": sessionId(),
        "ai.operation.name": "plugin-installer",
      },
      data: {
        baseType: baseType,
        baseData: baseData,
      },
    };

    var body = JSON.stringify([envelope]);

    try {
      // `text/plain` keeps the request a CORS "simple request" (no preflight),
      // which is what the Application Insights ingestion API expects.
      if (typeof navigator.sendBeacon === "function") {
        var blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
        if (navigator.sendBeacon(endpoint.trackUrl, blob)) return;
      }
      fetch(endpoint.trackUrl, {
        method: "POST",
        body: body,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        mode: "cors",
        credentials: "omit",
        keepalive: true,
      }).catch(function () {
        /* Telemetry must never break the page. */
      });
    } catch (error) {
      /* Telemetry must never break the page. */
    }
  }

  function trackEvent(name, properties) {
    if (!name) return;
    send("EventData", {
      ver: 2,
      name: String(name).slice(0, MAX_PROPERTY_LENGTH),
      properties: sanitizeProperties(properties),
    });
  }

  function exceptionType(exception) {
    var name =
      exception && typeof exception === "object" && typeof exception.name === "string"
        ? exception.name
        : "Error";
    return SAFE_EXCEPTION_TYPES.indexOf(name) !== -1 ? name : "Error";
  }

  function trackException(exception, properties) {
    var typeName = exceptionType(exception);
    send("ExceptionData", {
      ver: 2,
      exceptions: [
        {
          id: 1,
          outerId: 0,
          typeName: typeName,
          message: "An application exception occurred.",
          hasFullStack: false,
          stack: "Stack trace omitted for privacy.",
          parsedStack: [],
        },
      ],
      severityLevel: 3,
      properties: sanitizeProperties(properties),
    });
  }

  // Custom metric, reported as a single measurement with dimensions so that it
  // can be split per plugin in Application Insights.
  function trackMetric(name, value, properties) {
    if (!name) return;
    var numericValue = Number(value);
    if (!isFinite(numericValue)) return;
    send("MetricData", {
      ver: 2,
      metrics: [
        {
          name: String(name).slice(0, MAX_PROPERTY_LENGTH),
          kind: 0,
          value: numericValue,
        },
      ],
      properties: sanitizeProperties(properties),
    });
  }

  // Only the page name and the scenario are reported - never the full URL,
  // because query strings are visitor-provided input.
  function trackPageView(properties) {
    send("PageviewData", {
      ver: 2,
      name: document.title || "Install to Azure SRE Agent",
      properties: sanitizeProperties(properties),
    });
  }

  var pendingPageView = null;

  function flushPendingPageView() {
    if (!pendingPageView || !enabled()) return;
    var properties = pendingPageView;
    pendingPageView = null;
    trackPageView(properties);
  }

  function requestPageView(properties) {
    pendingPageView = properties || {};
    flushPendingPageView();
  }

  function resetSession() {
    pendingPageView = null;
    operationId = "";
    try {
      if (sessionStore) {
        sessionStore.removeItem("sre-agent-plugin-installer.session-id");
      }
    } catch (error) {
      /* ignore */
    }
  }

  function setConsent(granted) {
    consent = granted ? "granted" : "denied";
    writeConsent(granted);
    if (!granted) {
      resetSession();
    }
    renderConsentUi();
    flushPendingPageView();
  }

  // ---------------------------------------------------------------------------
  // Consent UI
  // ---------------------------------------------------------------------------

  function renderConsentUi() {
    var banner = document.getElementById("consent-banner");
    var status = document.getElementById("consent-status");
    var manage = document.getElementById("consent-manage");

    if (banner) {
      banner.hidden = !configured() || consent !== null;
    }
    if (manage) {
      manage.hidden = false;
    }
    var change = document.getElementById("consent-change");
    if (change) {
      change.hidden = !configured();
    }
    if (status) {
      if (!configured()) {
        status.textContent = "Analytics are disabled on this deployment.";
      } else if (consent === "granted") {
        status.textContent = "Anonymous analytics: on.";
      } else if (consent === "denied") {
        status.textContent = "Anonymous analytics: off.";
      } else {
        status.textContent = "Anonymous analytics: awaiting your choice.";
      }
    }
  }

  function initConsentUi() {
    var accept = document.getElementById("consent-accept");
    var decline = document.getElementById("consent-decline");
    var change = document.getElementById("consent-change");

    if (accept) {
      accept.addEventListener("click", function () {
        setConsent(true);
      });
    }
    if (decline) {
      decline.addEventListener("click", function () {
        setConsent(false);
      });
    }
    if (change) {
      change.addEventListener("click", function (event) {
        event.preventDefault();
        consent = null;
        resetSession();
        if (localStore) {
          try {
            localStore.removeItem(CONSENT_STORAGE_KEY);
          } catch (error) {
            /* ignore */
          }
        }
        renderConsentUi();
        var acceptButton = document.getElementById("consent-accept");
        if (acceptButton) {
          acceptButton.focus();
        }
      });
    }

    renderConsentUi();
  }

  function initExceptionTracking() {
    if (typeof window.addEventListener !== "function") return;

    window.addEventListener("error", function (event) {
      trackException(event && event.error, {
        handled: false,
        source: "window-error",
      });
    });
    window.addEventListener("unhandledrejection", function (event) {
      trackException(event && event.reason, {
        handled: false,
        source: "unhandled-rejection",
      });
    });
  }

  window.siteTelemetry = {
    trackEvent: trackEvent,
    trackException: trackException,
    trackMetric: trackMetric,
    trackPageView: requestPageView,
    isEnabled: enabled,
    isConfigured: configured,
    setConsent: setConsent,
  };

  initExceptionTracking();
  document.addEventListener("DOMContentLoaded", initConsentUi);
})();
