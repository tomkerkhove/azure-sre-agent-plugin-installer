// Azure SRE Agent Plugin Installer
//
// This page reads `repo` (and optional `path`) query string parameters to
// help visitors install a community plugin into their own Azure SRE Agent
// instance, and helps plugin authors generate the "Install to Azure SRE
// Agent" badge/link for their own README.
//
// Reference: https://learn.microsoft.com/en-us/azure/sre-agent/install-plugin-from-url

const SRE_AGENT_PORTAL_URL = "https://aka.ms/sreagent";
const BADGE_IMAGE_URL =
  "https://img.shields.io/badge/Install-Azure%20SRE%20Agent-0078D4?logo=microsoftazure&logoColor=white";
const DEFAULT_THEME = "light";
const SUPPORTED_THEMES = ["light", "dark"];

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

  function updateToggle(theme) {
    const isDark = theme === "dark";
    toggle.textContent = isDark ? "Light theme" : "Dark theme";
    toggle.setAttribute("aria-label", `Switch to ${isDark ? "light" : "dark"} theme`);
  }

  updateToggle(initialTheme);
  toggle.addEventListener("click", () => {
    const currentTheme = document.documentElement.getAttribute("data-theme");
    const nextTheme = applyTheme(currentTheme === "dark" ? "light" : "dark");
    const url = new URL(window.location.href);

    if (nextTheme === DEFAULT_THEME) {
      url.searchParams.delete("theme");
    } else {
      url.searchParams.set("theme", nextTheme);
    }

    window.history.replaceState(null, "", url);
    updateToggle(nextTheme);
  });
}

function buildBadgeMarkdown(installerUrl) {
  return `[![Install to Azure SRE Agent](${BADGE_IMAGE_URL})](${installerUrl})`;
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

  container.innerHTML = `
    <h2>Install <span>${repo}</span> to your Azure SRE Agent</h2>
    <dl class="plugin-meta">
      <dt>Source repository</dt>
      <dd><a href="${repoUrl}" target="_blank" rel="noopener noreferrer">${repoUrl}</a></dd>
      ${
        path
          ? `<dt>Path in repository</dt><dd><code>${path}</code></dd>`
          : ""
      }
    </dl>
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
    const themeInput = document.getElementById("gen-theme");
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
      pathInput,
      themeInput ? themeInput.value : DEFAULT_THEME
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

  const theme = applyTheme(params.get("theme"));
  initThemeToggle(theme);

  if (repo) {
    renderInstallCard(repo, path);
  }

  initGenerator();
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", init);
}

// Export pure functions for unit testing (Node/CommonJS) while keeping the
// browser bundle dependency-free.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeRepo,
    normalizeTheme,
    applyTheme,
    buildInstallerUrl,
    buildBadgeMarkdown,
    DEFAULT_THEME,
    SUPPORTED_THEMES,
  };
}
