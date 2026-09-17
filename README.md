# Azure SRE Agent Plugin Installer

[![Install to Azure SRE Agent](https://img.shields.io/badge/Install-Azure%20SRE%20Agent-0078D4?logo=microsoftazure&logoColor=white)](https://tomkerkhove.github.io/azure-sre-agent-plugin-installer/?repo=tomkerkhove/azure-carbon-sre)

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
[![Install to Azure SRE Agent](https://img.shields.io/badge/Install-Azure%20SRE%20Agent-0078D4?logo=microsoftazure&logoColor=white)](https://tomkerkhove.github.io/azure-sre-agent-plugin-installer/?repo=owner/repo)
```

When someone clicks the badge, they land on a page that:

1. Shows information about your plugin (source repository and, if provided,
   the path within the repository).
2. Walks them through the official
   [Install from URL](https://learn.microsoft.com/en-us/azure/sre-agent/install-plugin-from-url)
   flow in the Azure portal.
3. Provides a copy-to-clipboard shortcut for the repository reference they
   need to paste into their Azure SRE Agent instance.

### Choosing a theme

The page renders in a light theme by default. Add `theme=dark` to the link to
render it in a dark theme instead:

```markdown
[![Install to Azure SRE Agent](https://img.shields.io/badge/Install-Azure%20SRE%20Agent-0078D4?logo=microsoftazure&logoColor=white)](https://tomkerkhove.github.io/azure-sre-agent-plugin-installer/?repo=owner/repo&theme=dark)
```

Any other value falls back to the light theme. The badge generator on the site
lets you pick the theme and includes it in the generated link.

You can also use the **badge generator** on the site itself to build the
Markdown snippet for your repository without crafting the URL by hand.

## How it works

* [`index.html`](./index.html), [`assets/app.js`](./assets/app.js) and
  [`assets/style.css`](./assets/style.css) implement the static site.
* The site reads the `repo` (and optional `path` and `theme`) query string
  parameters at page load and renders installation instructions accordingly -
  no backend or build step is required.
* [`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml)
  publishes the site to GitHub Pages on every push to `main` or on demand.

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