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
  if (window.siteTelemetry) {
    window.siteTelemetry.trackEvent(name, properties);
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

  // Build the card with DOM APIs (instead of innerHTML) so that query string
  // input can never be interpreted as markup.
  container.textContent = "";

  const heading = document.createElement("h2");
  heading.append("Install ");
  const repoName = document.createElement("span");
  repoName.textContent = repo;
  heading.append(repoName, " to your Azure SRE Agent");
  container.append(heading);

  const meta = document.createElement("dl");
  meta.className = "plugin-meta";
  const sourceTerm = document.createElement("dt");
  sourceTerm.textContent = "Source repository";
  const sourceValue = document.createElement("dd");
  const sourceLink = document.createElement("a");
  sourceLink.href = repoUrl;
  sourceLink.target = "_blank";
  sourceLink.rel = "noopener noreferrer";
  sourceLink.textContent = repoUrl;
  sourceValue.append(sourceLink);
  meta.append(sourceTerm, sourceValue);

  if (path) {
    const pathTerm = document.createElement("dt");
    pathTerm.textContent = "Path in repository";
    const pathValue = document.createElement("dd");
    const pathCode = document.createElement("code");
    pathCode.textContent = path;
    pathValue.append(pathCode);
    meta.append(pathTerm, pathValue);
  }
  container.append(meta);

  const steps = document.createElement("ol");
  steps.className = "steps";
  [
    "Open your Azure SRE Agent instance in the Azure portal.",
    "Go to Builder > Plugins, then choose Install from URL.",
    "Paste the repository below and confirm the install.",
  ].forEach((text) => {
    const step = document.createElement("li");
    step.textContent = text;
    steps.append(step);
  });
  container.append(steps);

  const copyRow = document.createElement("div");
  copyRow.className = "copy-row";
  const repoValue = document.createElement("input");
  repoValue.id = "repo-value";
  repoValue.type = "text";
  repoValue.value = repo;
  repoValue.readOnly = true;
  const copyBtn = document.createElement("button");
  copyBtn.id = "copy-repo-btn";
  copyBtn.type = "button";
  copyBtn.textContent = "Copy";
  copyRow.append(repoValue, copyBtn);
  container.append(copyRow);

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent =
    "Don't have an Azure SRE Agent yet? Create one first, then come back to this page.";
  container.append(hint);

  const actions = document.createElement("div");
  actions.className = "actions";
  const portalLink = document.createElement("a");
  portalLink.className = "btn";
  portalLink.href = SRE_AGENT_PORTAL_URL;
  portalLink.target = "_blank";
  portalLink.rel = "noopener noreferrer";
  portalLink.textContent = "Open Azure SRE Agent";
  const sourceButton = document.createElement("a");
  sourceButton.className = "btn secondary";
  sourceButton.href = repoUrl;
  sourceButton.target = "_blank";
  sourceButton.rel = "noopener noreferrer";
  sourceButton.textContent = "View plugin source";
  actions.append(portalLink, sourceButton);
  container.append(actions);

  copyBtn.addEventListener("click", () => {
    copyToClipboard(repo).then(() => showToast("Repository copied to clipboard"));
    track("PluginRepositoryCopied", { repository: repo, hasPath: Boolean(path) });
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
    const pathInput = normalizePath(document.getElementById("gen-path").value);
    const repo = normalizeRepo(repoInput);

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
      pathInput
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

document.addEventListener("DOMContentLoaded", init);
