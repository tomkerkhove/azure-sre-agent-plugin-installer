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
2. Walks them through the official
   [Install from URL](https://learn.microsoft.com/en-us/azure/sre-agent/install-plugin-from-url)
   flow in the Azure portal.
3. Provides a copy-to-clipboard shortcut for the repository reference they
   need to paste into their Azure SRE Agent instance.

You can also use the **badge generator** on the site itself to build the
Markdown snippet for your repository without crafting the URL by hand.

## How it works

* [`index.html`](./index.html), [`assets/app.js`](./assets/app.js) and
  [`assets/style.css`](./assets/style.css) implement the static site.
* The site reads the `repo` (and optional `path`) query string parameters at
  page load and renders installation instructions accordingly - no backend or
  build step is required.
* [`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml)
  publishes the site to GitHub Pages on every push to `main` or on demand.

## Usage analytics

The site can report pseudonymous usage analytics (page views, generated badges and
which plugin repositories are installed) to Azure Application Insights, so that
adoption and scenarios can be understood.

* Telemetry is **opt-in**: visitors are asked for consent and nothing is sent
  until they agree. See [`PRIVACY.md`](./PRIVACY.md) for exactly what is
  collected.
* No cookies are used and no third-party scripts are loaded: events are posted
  straight to the Application Insights ingestion API from
  [`assets/telemetry.js`](./assets/telemetry.js).
* The only credential involved is the Application Insights **ingestion
  connection string**, which is write-only and cannot read telemetry or manage
  Azure resources. Managed identity/Entra ID tokens cannot be used from a static
  site, because any token shipped to the browser would be readable by everyone.

### Enabling it for your own deployment

1. Create an Application Insights resource and copy its connection string.
2. Add it as the `APPLICATIONINSIGHTS_CONNECTION_STRING` repository secret.
3. The [deploy workflow](./.github/workflows/deploy-pages.yml) generates
   [`assets/config.js`](./assets/config.js) from that secret at deploy time - the
   value is never committed to the repository.
4. Recommended hardening on the Azure side: enable
   [a daily ingestion cap](https://learn.microsoft.com/azure/azure-monitor/logs/daily-cap)
   to limit abuse of the public ingestion endpoint, and keep the default 90-day
   [data retention](https://learn.microsoft.com/azure/azure-monitor/logs/data-retention-configure).

Without the secret, `connectionString` stays empty and all telemetry (and the
consent banner) is disabled.

> **Note:** This project is not affiliated with or endorsed by Microsoft. It
> only links to the official Azure SRE Agent portal and documentation to help
> visitors complete the install themselves.