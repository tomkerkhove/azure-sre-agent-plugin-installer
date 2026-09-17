// Azure SRE Agent Plugin Installer
//
// This page reads `repo` (and optional `path`) query string parameters to
// help visitors install a community plugin into their own Azure SRE Agent
// instance, and helps plugin authors generate the "Install to Azure SRE
// Agent" badge/link for their own README.
//
// Reference: https://learn.microsoft.com/en-us/azure/sre-agent/install-plugin-from-url

const SRE_AGENT_PORTAL_URL = "https://aka.ms/sreagent";
const SRE_AGENT_API_DOCS_URL =
  "https://learn.microsoft.com/en-us/azure/sre-agent/install-plugin-from-url#use-the-rest-api";
const BADGE_IMAGE_URL =
  "https://img.shields.io/badge/Install-Azure%20SRE%20Agent-0078D4?logo=microsoftazure&logoColor=white";
const MANAGEMENT_SCOPE =
  "https://management.azure.com/user_impersonation";
const RESOURCE_GRAPH_URL =
  "https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2024-04-01";
const AGENT_API_VERSION = "2025-05-01-preview";
const DEFAULT_DATA_PLANE_SCOPE = "https://azuresre.dev/.default";
const AGENT_QUERY = `
Resources
| where type =~ 'microsoft.app/agents'
| project id, name, subscriptionId, resourceGroup, location,
    agentEndpoint=tostring(properties.agentEndpoint),
    powerState=tostring(properties.powerState)
| order by name asc
`;

let authClient = null;
let signedInAccount = null;
const DEFAULT_THEME = "light";
const SUPPORTED_THEMES = ["light", "dark"];

// `path` comes from the query string, so it is untrusted input: keep it to a
// conservative subset of characters before it is rendered or reported.
function normalizePath(rawPath) {
  if (!rawPath) return "";
  const path = rawPath.trim().replace(/^\/+|\/+$/g, "");
  if (!path || path.length > 200) return "";
  if (!/^[\w.\-\/]+$/.test(path) || path.includes("..")) return "";
  return path;
}

function track(name, properties) {
  if (typeof window !== "undefined" && window.siteTelemetry) {
    window.siteTelemetry.trackEvent(name, properties);
  }
}

// Custom metric so plugin installs can be counted and split per repository in
// Application Insights.
function trackPluginInstall(repo, properties) {
  if (typeof window !== "undefined" && window.siteTelemetry) {
    window.siteTelemetry.trackMetric(
      "PluginInstalls",
      1,
      Object.assign({ repository: repo }, properties || {})
    );
  }
}

function normalizeRepo(rawRepo) {
  if (!rawRepo) return null;

  let repo = rawRepo.trim();

  // Accept full GitHub URLs and reduce them to `owner/repo`.
  const githubUrlMatch = repo.match(
    /^https?:\/\/(www\.)?github\.com\/([^/]+)\/([^/]+?)(\.git)?\/?$/i
  );
  if (githubUrlMatch) {
    repo = `${githubUrlMatch[2]}/${githubUrlMatch[3]}`;
  }

  // Basic `owner/repo` shape validation.
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return null;
  }

  return repo;
}

function normalizeTheme(rawTheme) {
  if (typeof rawTheme !== "string") return DEFAULT_THEME;

  const theme = rawTheme.trim().toLowerCase();
  return SUPPORTED_THEMES.includes(theme) ? theme : DEFAULT_THEME;
}

function buildInstallerUrl(baseUrl, repo, path, theme) {
  const url = new URL(baseUrl);
  url.searchParams.set("repo", repo);
  if (path) {
    url.searchParams.set("path", path);
  }
  // The default theme needs no query parameter, keeping generated links short.
  const normalizedTheme = normalizeTheme(theme);
  if (normalizedTheme !== DEFAULT_THEME) {
    url.searchParams.set("theme", normalizedTheme);
  }
  return url.toString();
}

function applyTheme(theme) {
  const normalized = normalizeTheme(theme);
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.setAttribute("data-theme", normalized);
  }
  return normalized;
}

function initThemeToggle(initialTheme) {
  const toggle = document.getElementById("theme-toggle");
  if (!toggle) return;
  let currentTheme = initialTheme;

  function updateToggle(theme) {
    const isDark = theme === "dark";
    const label = `Switch to ${isDark ? "light" : "dark"} theme`;
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("title", label);
  }

  updateToggle(currentTheme);
  toggle.addEventListener("click", () => {
    currentTheme = applyTheme(currentTheme === "dark" ? "light" : "dark");
    const url = new URL(window.location.href);

    if (currentTheme === DEFAULT_THEME) {
      url.searchParams.delete("theme");
    } else {
      url.searchParams.set("theme", currentTheme);
    }

    window.history.replaceState(null, "", url);
    updateToggle(currentTheme);
  });
}

function buildBadgeMarkdown(installerUrl) {
  return `[![Install to Azure SRE Agent](${BADGE_IMAGE_URL})](${installerUrl})`;
}

function escapeHtml(value) {
  const characters = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return String(value).replace(/[&<>"']/g, (character) => characters[character]);
}

function normalizeAgentEndpoint(rawEndpoint) {
  if (!rawEndpoint) return null;

  try {
    const endpoint = new URL(rawEndpoint.trim());
    const isAgentHost = endpoint.hostname
      .toLowerCase()
      .endsWith(".azuresre.ai");

    if (
      endpoint.protocol !== "https:" ||
      !isAgentHost ||
      endpoint.port ||
      endpoint.username ||
      endpoint.password ||
      endpoint.pathname !== "/" ||
      endpoint.search ||
      endpoint.hash
    ) {
      return null;
    }

    return endpoint.origin;
  } catch {
    return null;
  }
}

function shellQuote(value) {
  return "'" + value.replace(/'/g, "'\"'\"'") + "'";
}

function buildImportCommand(endpoint, repo, path) {
  const requestBody = JSON.stringify({
    sourceUrl: repo,
    pathInRepo: path,
  });

  return `TOKEN=$(az account get-access-token \\
  --resource https://azuresre.dev \\
  --query accessToken \\
  --output tsv)

curl --fail-with-body --request POST \\
  --url ${shellQuote(`${endpoint}/api/v2/plugins/install-direct`)} \\
  --oauth2-bearer "$TOKEN" \\
  --header "Content-Type: application/json" \\
  --data ${shellQuote(requestBody)}`;
}

function getInstallerConfig() {
  const rawConfig =
    typeof window === "undefined"
      ? {}
      : window.SRE_AGENT_INSTALLER_CONFIG || {};
  const clientId =
    typeof rawConfig.clientId === "string" ? rawConfig.clientId.trim() : "";
  const tenantId =
    typeof rawConfig.tenantId === "string"
      ? rawConfig.tenantId.trim()
      : "organizations";
  const dataPlaneScope =
    typeof rawConfig.dataPlaneScope === "string"
      ? rawConfig.dataPlaneScope.trim()
      : DEFAULT_DATA_PLANE_SCOPE;

  return {
    clientId: /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
      clientId
    )
      ? clientId
      : "",
    tenantId: /^[a-z0-9.-]+$/i.test(tenantId)
      ? tenantId
      : "organizations",
    dataPlaneScope:
      dataPlaneScope === DEFAULT_DATA_PLANE_SCOPE
        ? dataPlaneScope
        : DEFAULT_DATA_PLANE_SCOPE,
  };
}

function getAuthRedirectUri() {
  return new URL("auth.html", window.location.href).toString();
}

async function getAuthClient() {
  if (authClient) return authClient;

  const config = getInstallerConfig();
  if (!config.clientId) {
    throw new Error("authentication_not_configured");
  }
  if (typeof msal === "undefined" || !msal.PublicClientApplication) {
    throw new Error("authentication_library_unavailable");
  }

  authClient = new msal.PublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      redirectUri: getAuthRedirectUri(),
    },
    cache: {
      cacheLocation: "memoryStorage",
      temporaryCacheLocation: "memoryStorage",
    },
  });
  await authClient.initialize();
  return authClient;
}

async function acquireAccessToken(
  scopes,
  { promptForAccount = false, forcePopup = false } = {}
) {
  const client = await getAuthClient();

  if (!signedInAccount || promptForAccount) {
    const result = await client.loginPopup({
      scopes,
      prompt: promptForAccount ? "select_account" : undefined,
    });
    signedInAccount = result.account;
    return result.accessToken;
  }

  if (forcePopup) {
    const result = await client.acquireTokenPopup({
      account: signedInAccount,
      scopes,
    });
    signedInAccount = result.account || signedInAccount;
    return result.accessToken;
  }

  try {
    const result = await client.acquireTokenSilent({
      account: signedInAccount,
      scopes,
    });
    return result.accessToken;
  } catch (error) {
    if (
      typeof msal !== "undefined" &&
      error instanceof msal.InteractionRequiredAuthError
    ) {
      const result = await client.acquireTokenPopup({
        account: signedInAccount,
        scopes,
      });
      signedInAccount = result.account;
      return result.accessToken;
    }
    throw error;
  }
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function getResponseMessage(response) {
  const text = (await response.text()).trim();
  if (!text) {
    return response.ok
      ? ""
      : `Request failed with status ${response.status}.`;
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      const body = JSON.parse(text);
      return (
        body?.error?.message ||
        body?.message ||
        body?.detail ||
        (response.ok ? "" : `Request failed with status ${response.status}.`)
      );
    } catch {
      return response.ok ? "" : `Request failed with status ${response.status}.`;
    }
  }

  return text.slice(0, 500);
}

async function queryAccessibleAgents(accessToken) {
  const results = [];
  let skipToken = "";

  do {
    const options = {
      "$top": 1000,
      resultFormat: "objectArray",
      allowPartialScopes: true,
    };
    if (skipToken) {
      options["$skipToken"] = skipToken;
    }

    const response = await fetch(RESOURCE_GRAPH_URL, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: {
        Authorization: ["Bearer", accessToken].join(" "),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: AGENT_QUERY,
        options,
      }),
    });

    if (!response.ok) {
      throw new ApiError(response.status, await getResponseMessage(response));
    }

    const result = await response.json();
    if (!Array.isArray(result.data)) {
      throw new Error("invalid_agent_response");
    }

    results.push(...result.data);
    skipToken =
      typeof result.$skipToken === "string" ? result.$skipToken : "";
  } while (skipToken);

  return results.map((agent) => ({
    id: String(agent.id || ""),
    name: String(agent.name || "Unnamed agent"),
    subscriptionId: String(agent.subscriptionId || ""),
    resourceGroup: String(agent.resourceGroup || ""),
    location: String(agent.location || ""),
    endpoint: normalizeAgentEndpoint(agent.agentEndpoint),
    powerState: String(agent.powerState || "Unknown"),
  }));
}

function normalizeAgentResourceId(resourceId) {
  if (typeof resourceId !== "string") return null;
  const normalized = resourceId.trim();
  return /^\/subscriptions\/[^/?#]+\/resourceGroups\/[^/?#]+\/providers\/Microsoft\.App\/agents\/[^/?#]+$/i.test(
    normalized
  )
    ? normalized
    : null;
}

function canAttemptInstallation(agent) {
  if (!agent || !normalizeAgentResourceId(agent.id)) return false;
  const powerState = agent.powerState.toLowerCase();
  return powerState === "running" || powerState === "unknown";
}

async function getCurrentAgent(agent, accessToken) {
  const resourceId = normalizeAgentResourceId(agent.id);
  if (!resourceId) {
    throw new Error("invalid_agent_resource_id");
  }

  const url = new URL(
    `${resourceId}?api-version=${AGENT_API_VERSION}`,
    "https://management.azure.com"
  );
  const response = await fetch(url, {
    method: "GET",
    mode: "cors",
    credentials: "omit",
    headers: {
      Authorization: ["Bearer", accessToken].join(" "),
    },
  });

  if (!response.ok) {
    throw new ApiError(response.status, await getResponseMessage(response));
  }

  const result = await response.json();
  return {
    ...agent,
    endpoint: normalizeAgentEndpoint(result?.properties?.agentEndpoint),
    powerState: String(result?.properties?.powerState || "Unknown"),
  };
}

async function importPlugin(agent, repo, path, accessToken) {
  const response = await fetch(
    `${agent.endpoint}/api/v2/plugins/install-direct`,
    {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: {
        Authorization: ["Bearer", accessToken].join(" "),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceUrl: repo,
        pathInRepo: path,
      }),
    }
  );

  if (!response.ok) {
    throw new ApiError(response.status, await getResponseMessage(response));
  }

  if (response.status === 204) return "";
  return getResponseMessage(response);
}

function getFriendlyError(error, action) {
  if (error?.message === "authentication_not_configured") {
    return "Online installation isn't configured yet. Use an alternative installation option below.";
  }
  if (error?.message === "authentication_library_unavailable") {
    return "Microsoft sign-in couldn't be loaded. Refresh the page or use an alternative installation option.";
  }
  if (
    error?.errorCode === "user_cancelled" ||
    error?.errorCode === "user_cancelled_request"
  ) {
    return "Sign-in was cancelled. Try again when you're ready.";
  }
  if (
    error?.errorCode === "popup_window_error" ||
    error?.errorCode === "empty_window_error"
  ) {
    return "Microsoft sign-in needs a pop-up window. Allow pop-ups for this site and try again.";
  }
  if (
    error?.errorCode === "consent_required" ||
    error?.errorCode === "interaction_required" ||
    /AADSTS65001|AADSTS650057|invalid_resource/i.test(error?.message || "")
  ) {
    return "This installer isn't permitted to request the required Azure access in your tenant. Ask an administrator to approve the app, or use an alternative installation option.";
  }
  if (error instanceof ApiError && error.status === 401) {
    return "Your sign-in has expired or isn't valid for this operation. Sign in again and retry.";
  }
  if (error instanceof ApiError && error.status === 403) {
    return action === "install"
      ? "You need the SRE Agent Author or Administrator role on this agent."
      : "You don't have permission to list Azure SRE Agents in this tenant.";
  }
  if (error instanceof TypeError) {
    return "The Azure endpoint couldn't be reached from this browser. Check your network and browser policy, or use an alternative installation option.";
  }
  if (error instanceof ApiError && error.message) {
    return `Azure returned: ${error.message}`;
  }
  return action === "install"
    ? "The plugin couldn't be installed. Try again or use an alternative installation option."
    : "Azure SRE Agents couldn't be loaded. Try again or use an alternative installation option.";
}

function setStatus(element, message, type = "") {
  element.textContent = message;
  element.className = `status${type ? ` ${type}` : ""}`;
  element.hidden = !message;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.remove("visible"), 1800);
}

function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback for non-secure contexts / older browsers.
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
  return Promise.resolve();
}

function initOnlineInstaller(repo, path) {
  const signInBtn = document.getElementById("sign-in-btn");
  const refreshAgentsBtn = document.getElementById("refresh-agents-btn");
  const changeAccountBtn = document.getElementById("change-account-btn");
  const form = document.getElementById("agent-install-form");
  const select = document.getElementById("agent-select");
  const details = document.getElementById("agent-details");
  const installBtn = document.getElementById("install-btn");
  const status = document.getElementById("online-status");
  const alternatives = document.getElementById("alternative-options");
  const config = getInstallerConfig();
  let agents = [];

  if (!config.clientId) {
    signInBtn.disabled = true;
    alternatives.open = true;
    setStatus(
      status,
      "Online installation isn't configured yet. Use an alternative installation option below.",
      "warning"
    );
    return;
  }

  async function loadAgents(promptForAccount) {
    signInBtn.disabled = true;
    refreshAgentsBtn.disabled = true;
    changeAccountBtn.disabled = true;
    form.hidden = true;
    setStatus(status, "Signing in and finding your Azure SRE Agents…");

    try {
      const accessToken = await acquireAccessToken(
        [MANAGEMENT_SCOPE],
        { promptForAccount }
      );
      agents = await queryAccessibleAgents(accessToken);

      select.replaceChildren(new Option("Choose an agent", ""));
      for (const [index, agent] of agents.entries()) {
        const state =
          agent.powerState && agent.powerState !== "Unknown"
            ? ` — ${agent.powerState}`
            : "";
        const option = new Option(
          `${agent.name} — ${agent.resourceGroup} (${agent.subscriptionId})${state}`,
          String(index)
        );
        option.disabled = !normalizeAgentResourceId(agent.id);
        select.add(option);
      }

      signInBtn.hidden = true;
      refreshAgentsBtn.hidden = false;
      changeAccountBtn.hidden = false;
      form.hidden = false;
      select.disabled = agents.length === 0;
      installBtn.disabled = true;
      details.textContent = "";

      if (agents.length === 0) {
        setStatus(
          status,
          "No Azure SRE Agents were found in this account. Check the account, tenant, and Azure RBAC access.",
          "warning"
        );
        return;
      }

      const accountName =
        signedInAccount?.username ||
        signedInAccount?.name ||
        "your Microsoft account";
      setStatus(
        status,
        `Signed in as ${accountName}. Choose one of ${agents.length} available agent${agents.length === 1 ? "" : "s"}.`,
        "success"
      );
    } catch (error) {
      alternatives.open = true;
      setStatus(status, getFriendlyError(error, "list"), "error");
    } finally {
      signInBtn.disabled = false;
      refreshAgentsBtn.disabled = false;
      changeAccountBtn.disabled = false;
    }
  }

  signInBtn.addEventListener("click", () => loadAgents(true));
  refreshAgentsBtn.addEventListener("click", () => loadAgents(false));
  changeAccountBtn.addEventListener("click", () => loadAgents(true));

  select.addEventListener("change", () => {
    const index = Number(select.value);
    const agent =
      select.value !== "" && Number.isInteger(index) ? agents[index] : null;

    if (!agent) {
      details.textContent = "";
      installBtn.disabled = true;
      return;
    }

    const location = agent.location ? ` in ${agent.location}` : "";
    details.textContent = `${agent.name}${location} — ${agent.powerState}`;

    if (!canAttemptInstallation(agent)) {
      installBtn.disabled = true;
      setStatus(
        status,
        "Start this Azure SRE Agent before installing the plugin.",
        "warning"
      );
      return;
    }

    installBtn.disabled = false;
    setStatus(
      status,
      `Ready to install ${repo} to ${agent.name}.`,
      "success"
    );
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const index = Number(select.value);
    const agent =
      select.value !== "" && Number.isInteger(index) ? agents[index] : null;
    if (!canAttemptInstallation(agent)) {
      return;
    }

    installBtn.disabled = true;
    select.disabled = true;
    refreshAgentsBtn.disabled = true;
    changeAccountBtn.disabled = true;
    setStatus(status, `Checking ${agent.name}…`);

    try {
      const dataPlaneToken = await acquireAccessToken(
        [config.dataPlaneScope],
        { forcePopup: true }
      );
      const managementToken = await acquireAccessToken([MANAGEMENT_SCOPE]);
      const currentAgent = await getCurrentAgent(agent, managementToken);
      agents[index] = currentAgent;

      if (!currentAgent.endpoint) {
        setStatus(
          status,
          "This agent doesn't have a valid data plane endpoint yet.",
          "warning"
        );
        return;
      }
      if (currentAgent.powerState.toLowerCase() !== "running") {
        setStatus(
          status,
          "Start this Azure SRE Agent, then refresh the list before installing.",
          "warning"
        );
        return;
      }

      setStatus(status, `Installing ${repo} to ${currentAgent.name}…`);
      const responseMessage = await importPlugin(
        currentAgent,
        repo,
        path,
        dataPlaneToken
      );
      setStatus(
        status,
        responseMessage ||
          `${repo} was installed successfully on ${currentAgent.name}.`,
        "success"
      );
    } catch (error) {
      alternatives.open = true;
      setStatus(status, getFriendlyError(error, "install"), "error");
    } finally {
      installBtn.disabled = !canAttemptInstallation(agents[index]);
      select.disabled = false;
      refreshAgentsBtn.disabled = false;
      changeAccountBtn.disabled = false;
    }
  });
}

function renderInstallCard(repo, path) {
  const container = document.getElementById("install-card");
  if (!container) return;

  const repoUrl = `https://github.com/${repo}`;
  const safePath = escapeHtml(path);

  container.innerHTML = `
    <h2>Install <span>${repo}</span> to your Azure SRE Agent</h2>
    <dl class="plugin-meta">
      <dt>Source repository</dt>
      <dd><a href="${repoUrl}" target="_blank" rel="noopener noreferrer">${repoUrl}</a></dd>
      ${
        path
          ? `<dt>Path in repository</dt><dd><code>${safePath}</code></dd>`
          : ""
      }
    </dl>
    <div class="online-installer">
      <h3>Choose an Azure SRE Agent</h3>
      <p>
        Sign in with Microsoft to find the agents you can access. Your access tokens
        stay in this browser tab and aren't stored by this site.
      </p>
      <div class="actions">
        <button id="sign-in-btn" type="button">Sign in and find agents</button>
        <button id="refresh-agents-btn" type="button" class="secondary" hidden>Refresh agents</button>
        <button id="change-account-btn" type="button" class="secondary" hidden>Change account</button>
      </div>
      <p id="online-status" class="status" role="status" aria-live="polite" hidden></p>
      <form id="agent-install-form" hidden>
        <div class="field">
          <label for="agent-select">Azure SRE Agent</label>
          <select id="agent-select" required disabled>
            <option value="">Choose an agent</option>
          </select>
        </div>
        <p id="agent-details" class="hint" aria-live="polite"></p>
        <button id="install-btn" type="submit" disabled>Install plugin</button>
      </form>
      <p class="hint">
        The selected agent must be running, and you need the SRE Agent Author or
        Administrator role. The online installer supports public GitHub repositories.
        The
        <a href="${SRE_AGENT_API_DOCS_URL}" target="_blank" rel="noopener noreferrer">plugin import API</a>
        is currently in preview. Browser installation also depends on support from
        your tenant and agent endpoint; use an option below if it isn't available.
      </p>
    </div>
    <details class="alternative-options" id="alternative-options">
      <summary>Other installation options</summary>
      <h3>Install in the Azure portal</h3>
      <ol class="steps">
        <li>Open your <strong>Azure SRE Agent</strong> instance in the Azure portal.</li>
        <li>Go to <strong>Builder &gt; Plugins</strong>, then choose <strong>Install from URL</strong>.</li>
        <li>Paste the repository below and confirm the install.</li>
      </ol>
      <div class="copy-row">
        <input id="repo-value" type="text" value="${repo}" readonly />
        <button id="copy-repo-btn" type="button">Copy</button>
      </div>
      <p class="hint">Don't have an Azure SRE Agent yet? Create one first, then come back to this page.</p>
      <div class="actions">
        <a class="btn" href="${SRE_AGENT_PORTAL_URL}" target="_blank" rel="noopener noreferrer">Open Azure SRE Agent</a>
        <a class="btn secondary" href="${repoUrl}" target="_blank" rel="noopener noreferrer">View plugin source</a>
      </div>
      <h3>Generate an Azure CLI command</h3>
      <p>
        Enter your agent's data plane endpoint to generate a command that imports this
        plugin using your local Azure CLI session.
      </p>
      <form id="api-import-form">
        <div class="field">
          <label for="agent-endpoint">Azure SRE Agent endpoint</label>
          <input
            id="agent-endpoint"
            type="url"
            placeholder="https://your-agent...azuresre.ai"
            autocomplete="url"
            required
          />
        </div>
        <div class="actions">
          <button type="submit">Generate import command</button>
          <button type="button" class="secondary" id="copy-import-btn" disabled>Copy command</button>
        </div>
      </form>
      <pre class="output" id="import-output" aria-live="polite" hidden></pre>
      <p class="hint">
        The command gets a short-lived token through your Azure CLI session.
      </p>
    </details>
  `;

  initOnlineInstaller(repo, path);

  const importForm = document.getElementById("api-import-form");
  const importOutput = document.getElementById("import-output");
  const copyImportBtn = document.getElementById("copy-import-btn");
  let importCommand = "";

  importForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const endpoint = normalizeAgentEndpoint(
      document.getElementById("agent-endpoint").value
    );

    importOutput.hidden = false;
    if (!endpoint) {
      importCommand = "";
      copyImportBtn.disabled = true;
      importOutput.textContent =
        "Enter a valid Azure SRE Agent endpoint ending in .azuresre.ai.";
      return;
    }

    importCommand = buildImportCommand(endpoint, repo, path);
    importOutput.textContent = importCommand;
    copyImportBtn.disabled = false;
  });

  copyImportBtn.addEventListener("click", () => {
    if (!importCommand) return;
    copyToClipboard(importCommand).then(() =>
      showToast("Import command copied to clipboard")
    );
  });

  const copyBtn = document.getElementById("copy-repo-btn");
  const portalLink = container.querySelector(`a[href="${SRE_AGENT_PORTAL_URL}"]`);
  copyBtn.addEventListener("click", () => {
    copyToClipboard(repo).then(() => showToast("Repository copied to clipboard"));
    track("PluginRepositoryCopied", { repository: repo, hasPath: Boolean(path) });
    trackPluginInstall(repo, { hasPath: Boolean(path), step: "repository-copied" });
  });

  portalLink.addEventListener("click", () => {
    track("AzureSreAgentOpened", { repository: repo });
  });

  container.hidden = false;
  document.getElementById("empty-state").hidden = true;
}

function initGenerator() {
  const form = document.getElementById("generator-form");
  const output = document.getElementById("generator-output");
  if (!form || !output) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const repoInput = document.getElementById("gen-repo").value;
    const rawPath = document.getElementById("gen-path").value.trim();
    const pathInput = normalizePath(rawPath);
    const themeInput = document.getElementById("gen-theme");
    const repo = normalizeRepo(repoInput);

    if (rawPath && !pathInput) {
      output.hidden = false;
      output.textContent =
        "Please enter a valid path within the repository, e.g. plugins/my-plugin";
      track("BadgeGenerationFailed", { reason: "invalid-path" });
      return;
    }

    if (!repo) {
      output.hidden = false;
      output.textContent =
        "Please enter a valid GitHub repository, e.g. owner/repo or https://github.com/owner/repo";
      track("BadgeGenerationFailed", { reason: "invalid-repository" });
      return;
    }

    const installerUrl = buildInstallerUrl(
      window.location.origin + window.location.pathname,
      repo,
      pathInput,
      themeInput ? themeInput.value : DEFAULT_THEME
    );
    const markdown = buildBadgeMarkdown(installerUrl);

    output.hidden = false;
    output.textContent = markdown;

    track("BadgeGenerated", { hasPath: Boolean(pathInput) });
  });

  document.getElementById("copy-badge-btn").addEventListener("click", () => {
    if (!output.textContent) return;
    copyToClipboard(output.textContent).then(() =>
      showToast("Badge markdown copied to clipboard")
    );
    track("BadgeMarkdownCopied");
  });
}

function init() {
  const params = new URLSearchParams(window.location.search);
  const repo = normalizeRepo(params.get("repo"));
  const path = normalizePath(params.get("path"));

  const theme = applyTheme(params.get("theme"));
  initThemeToggle(theme);

  if (repo) {
    renderInstallCard(repo, path);
  }

  initGenerator();

  if (window.siteTelemetry) {
    window.siteTelemetry.trackPageView({
      scenario: repo ? "plugin-install" : "badge-generator",
      repository: repo || "",
      hasPath: Boolean(path),
    });
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", init);
}

// Export pure functions for unit testing (Node/CommonJS) while keeping the
// browser bundle dependency-free.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeRepo,
    normalizePath,
    normalizeTheme,
    applyTheme,
    buildInstallerUrl,
    buildBadgeMarkdown,
    DEFAULT_THEME,
    SUPPORTED_THEMES,
  };
}
