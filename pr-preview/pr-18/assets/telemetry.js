// Cookieless, region-aware Azure Application Insights telemetry.
//
// Design goals (see PRIVACY.md):
//   * Ask for consent in Europe and whenever the visitor's region is unclear.
//   * Enable analytics elsewhere while preserving explicit privacy choices.
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
  var CONSENT_CHANNEL_NAME = "sre-agent-plugin-installer.analytics-consent-sync";
  var CONSENT_VERSION = 2;
  var MAX_PROPERTIES = 12;
  var MAX_PROPERTY_LENGTH = 256;
  var NON_EUROPEAN_TIME_ZONE_PREFIXES = [
    "Africa/",
    "America/",
    "Antarctica/",
    "Asia/",
    "Australia/",
    "Indian/",
    "Pacific/",
  ];
  var EUROPEAN_TIME_ZONE_EXCEPTIONS = {
    "Africa/Ceuta": true,
    "America/Cayenne": true,
    "America/Guadeloupe": true,
    "America/Marigot": true,
    "America/Martinique": true,
    "Asia/Famagusta": true,
    "Asia/Istanbul": true,
    "Asia/Nicosia": true,
    "Indian/Mayotte": true,
    "Indian/Reunion": true,
  };
  var NON_EUROPEAN_TIME_ZONE_ALIASES = {
    "Atlantic/Bermuda": true,
    "Atlantic/Cape_Verde": true,
    "Atlantic/South_Georgia": true,
    "Atlantic/St_Helena": true,
    "Atlantic/Stanley": true,
    "Brazil/Acre": true,
    "Brazil/DeNoronha": true,
    "Brazil/East": true,
    "Brazil/West": true,
    "Canada/Atlantic": true,
    "Canada/Central": true,
    "Canada/Eastern": true,
    "Canada/Mountain": true,
    "Canada/Newfoundland": true,
    "Canada/Pacific": true,
    "Canada/Saskatchewan": true,
    "Canada/Yukon": true,
    "Chile/Continental": true,
    "Chile/EasterIsland": true,
    Cuba: true,
    CST6CDT: true,
    Egypt: true,
    EST5EDT: true,
    HST: true,
    Hongkong: true,
    Iran: true,
    Israel: true,
    Jamaica: true,
    Japan: true,
    Kwajalein: true,
    Libya: true,
    "Mexico/BajaNorte": true,
    "Mexico/BajaSur": true,
    "Mexico/General": true,
    MST7MDT: true,
    Navajo: true,
    NZ: true,
    "NZ-CHAT": true,
    PRC: true,
    PST8PDT: true,
    ROC: true,
    ROK: true,
    Singapore: true,
    "US/Alaska": true,
    "US/Aleutian": true,
    "US/Arizona": true,
    "US/Central": true,
    "US/East-Indiana": true,
    "US/Eastern": true,
    "US/Hawaii": true,
    "US/Indiana-Starke": true,
    "US/Michigan": true,
    "US/Mountain": true,
    "US/Pacific": true,
    "US/Samoa": true,
  };
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
  var SAFE_EXCEPTION_OPERATIONS = ["list-agents", "install-plugin"];
  var SAFE_EXCEPTION_SOURCES = ["window-error", "unhandled-rejection"];

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

  function safeStorage(name) {
    try {
      var storage = window[name];
      if (!storage) return null;
      var probe = "__probe__";
      storage.setItem(probe, "1");
      storage.removeItem(probe);
      return storage;
    } catch (error) {
      return null;
    }
  }

  var localStore = safeStorage("localStorage");
  var sessionStore = safeStorage("sessionStorage");
  var consentStore = null;
  var consentChannel = null;
  var consentNeedsRenewal = false;
  var latestConsentDecisionAt = 0;

  function consentStorageCandidates(preferredStore) {
    var stores = [];
    if (preferredStore) stores.push(preferredStore);
    if (localStore && stores.indexOf(localStore) === -1) stores.push(localStore);
    if (sessionStore && stores.indexOf(sessionStore) === -1) stores.push(sessionStore);
    return stores;
  }

  function readConsent() {
    var stores = consentStorageCandidates();
    var hadReadError = false;
    var hadInvalidRecord = false;
    var latestDecision = null;
    for (var i = 0; i < stores.length; i++) {
      var raw;
      try {
        raw = stores[i].getItem(CONSENT_STORAGE_KEY);
        if (!consentStore) consentStore = stores[i];
      } catch (error) {
        hadReadError = true;
        continue;
      }
      if (!raw) continue;

      consentStore = stores[i];
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        hadInvalidRecord = true;
        continue;
      }
      if (!parsed || parsed.version !== CONSENT_VERSION) {
        hadInvalidRecord = true;
        continue;
      }
      if (parsed.probe === true) {
        hadInvalidRecord = true;
        continue;
      }

      var decidedAt =
        typeof parsed.decidedAt === "string" ? Date.parse(parsed.decidedAt) : 0;
      if (!isFinite(decidedAt)) decidedAt = 0;
      if (!latestDecision || decidedAt > latestDecision.decidedAt) {
        latestDecision = {
          consent: parsed.granted === true ? "granted" : "denied",
          decidedAt: decidedAt,
          store: stores[i],
        };
      }
    }

    if (latestDecision) {
      consentStore = latestDecision.store;
      latestConsentDecisionAt = Math.max(
        latestConsentDecisionAt,
        latestDecision.decidedAt
      );
      return latestDecision.consent;
    }
    if (hadReadError || hadInvalidRecord) {
      consentNeedsRenewal = true;
    }
    return null;
  }

  function nextConsentDecisionAt() {
    return new Date(
      Math.max(Date.now(), latestConsentDecisionAt + 1)
    ).toISOString();
  }

  function writeConsent(granted, decidedAt) {
    decidedAt = decidedAt || nextConsentDecisionAt();
    latestConsentDecisionAt = Date.parse(decidedAt);
    var value = JSON.stringify({
      version: CONSENT_VERSION,
      granted: granted,
      decidedAt: decidedAt,
    });
    var stores = consentStorageCandidates();
    for (var i = 0; i < stores.length; i++) {
      try {
        stores[i].setItem(CONSENT_STORAGE_KEY, value);
        consentStore = stores[i];
        for (var j = 0; j < stores.length; j++) {
          if (j === i) continue;
          try {
            stores[j].removeItem(CONSENT_STORAGE_KEY);
          } catch (error) {
            /* A newer record in the selected store still takes precedence. */
          }
        }
        return;
      } catch (error) {
        /* Try the next available preference store. */
      }
    }
  }

  function clearStoredConsent() {
    var stores = consentStorageCandidates();
    for (var i = 0; i < stores.length; i++) {
      try {
        stores[i].removeItem(CONSENT_STORAGE_KEY);
      } catch (error) {
        /* Ignore stores that are no longer available. */
      }
    }
  }

  function canPersistConsent() {
    var value = JSON.stringify({
      version: CONSENT_VERSION,
      granted: false,
      probe: true,
    });
    var stores = consentStorageCandidates();
    for (var i = 0; i < stores.length; i++) {
      try {
        stores[i].setItem(CONSENT_STORAGE_KEY, value);
        if (stores[i].getItem(CONSENT_STORAGE_KEY) !== value) continue;
        stores[i].removeItem(CONSENT_STORAGE_KEY);
        consentStore = stores[i];
        return true;
      } catch (error) {
        try {
          if (stores[i].getItem(CONSENT_STORAGE_KEY) === value) {
            stores[i].removeItem(CONSENT_STORAGE_KEY);
          }
        } catch (cleanupError) {
          /* A leftover probe is treated as invalid consent and fails closed. */
        }
      }
    }
    return false;
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

  function isKnownNonEuropeanTimeZone(timeZone) {
    if (EUROPEAN_TIME_ZONE_EXCEPTIONS[timeZone] === true) return false;
    if (NON_EUROPEAN_TIME_ZONE_ALIASES[timeZone] === true) return true;

    for (var i = 0; i < NON_EUROPEAN_TIME_ZONE_PREFIXES.length; i++) {
      if (timeZone.indexOf(NON_EUROPEAN_TIME_ZONE_PREFIXES[i]) === 0) {
        return true;
      }
    }
    return false;
  }

  function canonicalizeTimeZone(timeZone) {
    try {
      var canonicalTimeZone = Intl.DateTimeFormat(undefined, {
        timeZone: timeZone,
      }).resolvedOptions().timeZone;
      return typeof canonicalTimeZone === "string" && canonicalTimeZone
        ? canonicalTimeZone
        : null;
    } catch (error) {
      return null;
    }
  }

  function requiresConsent() {
    try {
      var timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (typeof timeZone !== "string" || !timeZone) return true;

      // Only identifiers known to be outside Europe bypass consent. European
      // aliases, fixed offsets and malformed values all fail closed.
      var canonicalTimeZone = canonicalizeTimeZone(timeZone);
      return (
        canonicalTimeZone === null ||
        !isKnownNonEuropeanTimeZone(canonicalTimeZone)
      );
    } catch (error) {
      return true;
    }
  }

  var config = (window.SITE_CONFIG && window.SITE_CONFIG.telemetry) || {};
  var endpoint = parseConnectionString(config.connectionString);
  var cloudRole = config.cloudRole || "sre-agent-plugin-installer";
  var consent = readConsent();
  if (
    consent === null &&
    !consentNeedsRenewal &&
    !requiresConsent() &&
    canPersistConsent()
  ) {
    consent = "granted";
  }
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

  function sanitizeExceptionProperties(properties) {
    var result = {};
    if (!properties || typeof properties !== "object") return result;

    if (typeof properties.handled === "boolean") {
      result.handled = String(properties.handled);
    }
    if (SAFE_EXCEPTION_OPERATIONS.indexOf(properties.operation) !== -1) {
      result.operation = properties.operation;
    }
    if (SAFE_EXCEPTION_SOURCES.indexOf(properties.source) !== -1) {
      result.source = properties.source;
    }
    if (
      Number.isInteger(properties.status) &&
      properties.status >= 100 &&
      properties.status <= 599
    ) {
      result.status = String(properties.status);
    }
    return result;
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
      properties: sanitizeExceptionProperties(properties),
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

  function applySynchronizedConsent(nextConsent) {
    consent = nextConsent;
    if (consent !== "granted") {
      resetSession();
    }
    renderConsentUi();
    flushPendingPageView();
  }

  function broadcastConsent(nextConsent, decidedAt) {
    if (!consentChannel) return;
    try {
      consentChannel.postMessage({
        version: CONSENT_VERSION,
        consent: nextConsent,
        decidedAt: decidedAt,
      });
    } catch (error) {
      /* The storage event remains available when broadcasting fails. */
    }
  }

  function setConsent(granted) {
    var decidedAt = nextConsentDecisionAt();
    consent = granted ? "granted" : "denied";
    consentNeedsRenewal = false;
    writeConsent(granted, decidedAt);
    broadcastConsent(consent, decidedAt);
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
        var decidedAt = nextConsentDecisionAt();
        latestConsentDecisionAt = Date.parse(decidedAt);
        consent = null;
        resetSession();
        clearStoredConsent();
        broadcastConsent(null, decidedAt);
        renderConsentUi();
        var acceptButton = document.getElementById("consent-accept");
        if (acceptButton) {
          acceptButton.focus();
        }
      });
    }

    renderConsentUi();
  }

  function initConsentSync() {
    if (typeof window.addEventListener !== "function") return;

    window.addEventListener("storage", function (event) {
      if (!event || event.key !== CONSENT_STORAGE_KEY) return;
      if (event.storageArea && localStore && event.storageArea !== localStore) return;
      try {
        if (
          (event.newValue && JSON.parse(event.newValue).probe === true) ||
          (event.oldValue && JSON.parse(event.oldValue).probe === true)
        ) {
          return;
        }
      } catch (error) {
        /* Invalid records are handled by readConsent and fail closed. */
      }

      consentNeedsRenewal = false;
      applySynchronizedConsent(readConsent());
    });

    try {
      if (typeof window.BroadcastChannel !== "function") return;
      consentChannel = new window.BroadcastChannel(CONSENT_CHANNEL_NAME);
      consentChannel.onmessage = function (event) {
        var message = event && event.data;
        if (!message || message.version !== CONSENT_VERSION) return;
        if (
          message.consent !== "granted" &&
          message.consent !== "denied" &&
          message.consent !== null
        ) {
          return;
        }
        var decidedAt = Date.parse(message.decidedAt);
        if (!isFinite(decidedAt) || decidedAt <= latestConsentDecisionAt) return;
        consentNeedsRenewal = false;
        latestConsentDecisionAt = decidedAt;
        if (message.consent === null) {
          clearStoredConsent();
        } else {
          writeConsent(message.consent === "granted", message.decidedAt);
        }
        applySynchronizedConsent(message.consent);
      };
    } catch (error) {
      consentChannel = null;
    }
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

  initConsentSync();
  initExceptionTracking();
  document.addEventListener("DOMContentLoaded", initConsentUi);
})();
