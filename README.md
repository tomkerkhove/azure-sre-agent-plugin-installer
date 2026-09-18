# Azure SRE Agent Plugin Installer

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logos/svg/logo-horizontal-dark.svg">
  <img src="assets/logos/svg/logo-horizontal-light.svg" alt="Azure SRE Agent Plugin Installer">
</picture>

[![Install to Azure SRE Agent](https://img.shields.io/badge/Install-Azure%20SRE%20Agent-0078D4?logo=microsoftazure&logoColor=white)](https://tomkerkhove.github.io/azure-sre-agent-plugin-installer/install.html?repo=tomkerkhove/azure-carbon-sre)

A "Deploy to Azure" button, but for [Azure SRE Agent](https://aka.ms/sreagent) plugins.

This repository hosts a small static site that helps plugin authors add an
**Install to Azure SRE Agent** badge to their own repository's README, so that
visitors can install the plugin into their own Azure SRE Agent instance with a
single click. It's inspired by the
[Deploy to Azure button](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-to-azure-button).

The site has two pages, linked together through top-level navigation:

* [`index.html`](./index.html) - the landing page with the **badge generator**,
  for plugin authors who want to build an install link/badge for their README.
* [`install.html`](./install.html) - the **install plugin** page that visitors
  land on when they click a generated badge, with the `repo` query parameter
  pointing at the plugin's GitHub repository.

## Adding the badge to your plugin's README

Add a badge that links to the install page with a `repo` query parameter
pointing at your plugin's GitHub repository (and an optional `path` if the
plugin lives in a subfolder):

```markdown
[![Install to Azure SRE Agent](https://img.shields.io/badge/Install-Azure%20SRE%20Agent-0078D4?logo=microsoftazure&logoColor=white)](https://tomkerkhove.github.io/azure-sre-agent-plugin-installer/install.html?repo=owner/repo)
```

When someone clicks the badge, they land on the install page that:

1. Shows information about your plugin (source repository and, if provided,
   the path within the repository).
2. Lets them sign in with Microsoft and lists the Azure SRE Agents they can
   access through Azure Resource Graph.
3. Lets them choose a running agent and install the plugin through the official
   [`POST /api/v2/plugins/install-direct`](https://learn.microsoft.com/en-us/azure/sre-agent/install-plugin-from-url#use-the-rest-api)
   endpoint.
4. Provides the official
   [Install from URL](https://learn.microsoft.com/en-us/azure/sre-agent/install-plugin-from-url)
   flow and a generated Azure CLI command as alternatives.

> Badges generated before this site had separate landing and install pages
> point at the landing page with a `repo` query parameter. The landing page
> automatically redirects those links to the install page, so existing
> badges keep working.

### Choosing a theme

The page renders in a light theme by default. Visitors can use the theme button
at the top of the page to switch between light and dark colors. Add `theme=dark`
to the link to render it in a dark theme initially:

```markdown
[![Install to Azure SRE Agent](https://img.shields.io/badge/Install-Azure%20SRE%20Agent-0078D4?logo=microsoftazure&logoColor=white)](https://tomkerkhove.github.io/azure-sre-agent-plugin-installer/install.html?repo=owner/repo&theme=dark)
```

Any other value falls back to the light theme. The badge generator on the site
lets you pick the theme and includes it in the generated link.

You can also use the **badge generator** on the landing page to build the
Markdown snippet for your repository without crafting the URL by hand.

## Configure the online installer

The agent selector needs a public Microsoft Entra single-page application:

1. Create an app registration that supports accounts in any organizational
  directory. For a tenant-specific deployment, use a single-tenant
  registration instead.
2. Add this **Single-page application** redirect URI:
  `https://tomkerkhove.github.io/azure-sre-agent-plugin-installer/auth.html`.
3. Add the **Azure Service Management** delegated `user_impersonation`
  permission.
4. Add and grant tenant consent for the delegated Azure SRE Agent API
  permission exposed for the `https://azuresre.dev` resource. The installer
  requests its statically configured permissions with
  `https://azuresre.dev/.default` when the user confirms an install. If the
  Azure SRE Agent permission isn't available to the app registration, leave
  online installation disabled and use the CLI or portal flow.
5. Add the app's client ID as the `AZURE_CLIENT_ID` repository variable under
  **Settings > Secrets and variables > Actions > Variables**.
6. Optionally add an `AZURE_TENANT_ID` repository variable containing a tenant
  ID for a single-tenant deployment. It defaults to `organizations`.

A client ID and tenant ID are public configuration, not secrets. Do not create
or configure a client secret for this browser application.

The GitHub Pages workflow writes these values to `assets/config.js` when it
deploys. If no client ID is configured, the page automatically expands the
Azure CLI and portal alternatives.

> **Preview limitations:** Microsoft doesn't currently document whether
> arbitrary SPA registrations can request the Azure SRE Agent data plane scope,
> or whether agent data plane endpoints allow cross-origin requests from GitHub
> Pages. Validate both in the target tenant before enabling `AZURE_CLIENT_ID`.
> The page reports these failures and preserves the CLI and portal fallbacks.

## How it works

* [`index.html`](./index.html) (badge generator), [`install.html`](./install.html)
  (install flow), [`assets/app.js`](./assets/app.js) and
  [`assets/style.css`](./assets/style.css) implement the static site.
* The install page reads the `repo` and optional `path` and `theme` query
  string parameters at page load and renders installation instructions
  accordingly.
* The online installer uses
  [`@azure/msal-browser`](https://www.npmjs.com/package/@azure/msal-browser)
  4 LTS with memory-only caching and popup interactions. Tokens remain in the
  current browser tab and are never written to local or session storage.
* Azure Resource Graph discovers the agents visible to the signed-in identity.
  Only an agent endpoint returned by Azure and ending in `.azuresre.ai` is used
  for an installation request.
* The Azure CLI fallback gets a short-lived token from the visitor's local CLI
  session; the site never receives it.
* [`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml)
  publishes the site to GitHub Pages on every push to `main` or on demand.

## Local development

Install dependencies, build the browser dependency, and serve the site:

```bash
npm ci
npm run build
npm run serve
```

To test sign-in locally, add `http://127.0.0.1:4173/auth.html` as a
single-page application redirect URI and set the client ID in
`assets/config.js`.

## PR previews

[`.github/workflows/pr-preview.yml`](./.github/workflows/pr-preview.yml)
automatically deploys a preview of the site for every pull request, so
changes can be reviewed and tested live before merging. Each pull request is
deployed to its own path
(`https://tomkerkhove.github.io/azure-sre-agent-plugin-installer/pr-preview/pr-<number>/`),
so multiple PRs can have previews live at the same time without overwriting
each other or the production site. The workflow posts a comment on the pull
request with a link to the preview and updates that same comment every time
new commits are pushed. The preview is removed automatically when the pull
request is closed.

## Testing

The site's logic and UI are covered by automated tests, run in CI via
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) on every push and
pull request to `main`.

Install dependencies first:

```bash
npm install
```

* **Unit tests** ([Jest](https://jestjs.io/)) cover the pure logic in
  [`assets/app.js`](./assets/app.js), such as repository normalization and
  badge URL/markdown generation and theme normalization:

  ```bash
  npm test
  ```

* **UI tests** ([Playwright](https://playwright.dev/)) exercise the site in a
  real browser - covering the empty state, install card rendering, the badge
  generator form, theme selection, and the copy-to-clipboard actions:

  ```bash
  npx playwright install --with-deps chromium
  npm run test:e2e
  ```

Every behavior change - by humans or AI agents - must come with tests. See
[`AGENTS.md`](./AGENTS.md) for the guidelines that agents contributing to this
repository must follow.

> **Note:** This project is not affiliated with or endorsed by Microsoft. It
> only links to the official Azure SRE Agent portal and documentation to help
> visitors complete the install themselves.