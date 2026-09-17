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
2. Generates an Azure CLI command that uses the official
   [`POST /api/v2/plugins/install-direct`](https://learn.microsoft.com/en-us/azure/sre-agent/install-plugin-from-url#use-the-rest-api)
   endpoint to import the plugin directly.
3. Provides the official
   [Install from URL](https://learn.microsoft.com/en-us/azure/sre-agent/install-plugin-from-url)
   flow in the Azure portal as a manual alternative.
4. Provides copy-to-clipboard shortcuts for the generated import command and
   repository reference.

You can also use the **badge generator** on the site itself to build the
Markdown snippet for your repository without crafting the URL by hand.

## How it works

* [`index.html`](./index.html), [`assets/app.js`](./assets/app.js) and
  [`assets/style.css`](./assets/style.css) implement the static site.
* The site reads the `repo` (and optional `path`) query string parameters at
  page load and renders installation instructions accordingly.
* API-assisted imports run through the visitor's local Azure CLI session, so
  access tokens are never entered into or stored by the site. No backend or
  build step is required.
* [`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml)
  publishes the site to GitHub Pages on every push to `main` or on demand.

> **Note:** This project is not affiliated with or endorsed by Microsoft. It
> only links to the official Azure SRE Agent portal and documentation to help
> visitors complete the install themselves.