# Azure SRE Agent Plugin Installer

[![Install to Azure SRE Agent](https://img.shields.io/badge/Install-Azure%20SRE%20Agent-0078D4?logo=microsoftazure&logoColor=white)](https://tomkerkhove.github.io/tomkerkhove-azure-sre-agent-plugin-installer/?repo=tomkerkhove/azure-carbon-sre)

A "Deploy to Azure" button, but for [Azure SRE Agent](https://aka.ms/sreagent) plugins.

This repository hosts a small static site that helps plugin authors add an
**Install to Azure SRE Agent** badge to their own repository's README, so that
visitors can install the plugin into their own Azure SRE Agent instance with a
single click. It's inspired by the
[Deploy to Azure button](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-to-azure-button).

## Adding the badge to your plugin's README

Add a badge that links to this site with a `repo` query parameter pointing at
your plugin's GitHub repository (and an optional `path` if the plugin lives in
a subfolder):

```markdown
[![Install to Azure SRE Agent](https://img.shields.io/badge/Install-Azure%20SRE%20Agent-0078D4?logo=microsoftazure&logoColor=white)](https://tomkerkhove.github.io/tomkerkhove-azure-sre-agent-plugin-installer/?repo=owner/repo)
```

When someone clicks the badge, they land on a page that:

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

You can also use the **badge generator** on the site itself to build the
Markdown snippet for your repository without crafting the URL by hand.

## Configure the online installer

The agent selector needs a public Microsoft Entra single-page application:

1. Create an app registration that supports accounts in any organizational
  directory. For a tenant-specific deployment, use a single-tenant
  registration instead.
2. Add this **Single-page application** redirect URI:
  `https://tomkerkhove.github.io/tomkerkhove-azure-sre-agent-plugin-installer/auth.html`.
3. Add the **Azure Service Management** delegated `user_impersonation`
  permission. The installer separately requests the Azure SRE Agent data plane
  scope, `https://azuresre.dev/.default`, when the user confirms an install.
  Tenant consent policies still apply.
4. Add the app's client ID as the `AZURE_CLIENT_ID` repository variable under
  **Settings > Secrets and variables > Actions > Variables**.
5. Optionally add an `AZURE_TENANT_ID` repository variable containing a tenant
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

* [`index.html`](./index.html), [`assets/app.js`](./assets/app.js) and
  [`assets/style.css`](./assets/style.css) implement the static site.
* The site reads the `repo` (and optional `path`) query string parameters at
  page load and renders installation instructions accordingly.
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

Install dependencies, build the browser dependency, and serve the repository:

```bash
npm ci
npm run build
python3 -m http.server 8000
```

To test sign-in locally, add `http://localhost:8000/auth.html` as a
single-page application redirect URI and set the client ID in
`assets/config.js`. Run `npm test` for the unit tests.

> **Note:** This project is not affiliated with or endorsed by Microsoft. It
> only links to the official Azure SRE Agent portal and documentation to help
> visitors complete the install themselves.