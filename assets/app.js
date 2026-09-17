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

function buildInstallerUrl(baseUrl, repo, path) {
  const url = new URL(baseUrl);
  url.searchParams.set("repo", repo);
  if (path) {
    url.searchParams.set("path", path);
  }
  return url.toString();
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
    <h3>Install with the REST API</h3>
    <p>
      Enter your agent's data plane endpoint to generate an Azure CLI command that
      imports this plugin directly.
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
      The agent must be running, and you need the SRE Agent Author or Administrator role.
      The command uses the
      <a href="${SRE_AGENT_API_DOCS_URL}" target="_blank" rel="noopener noreferrer">preview plugin import API</a>
      and gets a short-lived token through your Azure CLI session.
    </p>
    <h3>Or install in the Azure portal</h3>
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
  `;

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
  copyBtn.addEventListener("click", () => {
    copyToClipboard(repo).then(() => showToast("Repository copied to clipboard"));
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
    const pathInput = document.getElementById("gen-path").value.trim();
    const repo = normalizeRepo(repoInput);

    if (!repo) {
      output.hidden = false;
      output.textContent =
        "Please enter a valid GitHub repository, e.g. owner/repo or https://github.com/owner/repo";
      return;
    }

    const installerUrl = buildInstallerUrl(
      window.location.origin + window.location.pathname,
      repo,
      pathInput
    );
    const markdown = buildBadgeMarkdown(installerUrl);

    output.hidden = false;
    output.textContent = markdown;
  });

  document.getElementById("copy-badge-btn").addEventListener("click", () => {
    if (!output.textContent) return;
    copyToClipboard(output.textContent).then(() =>
      showToast("Badge markdown copied to clipboard")
    );
  });
}

function init() {
  const params = new URLSearchParams(window.location.search);
  const repo = normalizeRepo(params.get("repo"));
  const path = params.get("path") || "";

  if (repo) {
    renderInstallCard(repo, path);
  }

  initGenerator();
}

document.addEventListener("DOMContentLoaded", init);
