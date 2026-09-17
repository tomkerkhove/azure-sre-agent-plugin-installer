# Privacy statement

This site is a static page hosted on GitHub Pages. It has no backend, no user
accounts and no login. To understand adoption (how many people use the site,
which scenarios they use and which plugins get installed) it can send anonymous
usage analytics to [Azure Application Insights](https://learn.microsoft.com/azure/azure-monitor/app/app-insights-overview).

## Consent first

* Analytics are **off by default**. Nothing is sent until you press
  **Allow analytics** in the banner.
* Choosing **Decline** stops all telemetry; the choice is remembered in
  `localStorage` (a strictly functional, first-party entry, not a cookie).
* You can change your choice at any time through **Change privacy choice** in
  the page footer.

## No cookies

The site sets **no cookies** and loads no third-party scripts, advertising or
social media widgets. Two first-party browser storage entries are used:

| Key | Storage | Purpose |
| --- | --- | --- |
| `sre-agent-plugin-installer.analytics-consent` | `localStorage` | Remembers your privacy choice. |
| `sre-agent-plugin-installer.session-id` | `sessionStorage` | Random per-tab identifier used to group events of a single visit. Cleared when the tab closes and when consent is withdrawn. |

## What is collected

Only after consent, and only these fields:

* A page view with the scenario (`plugin-install` or `badge-generator`).
* Events describing what happened: `BadgeGenerated`, `BadgeMarkdownCopied`,
  `BadgeGenerationFailed`, `PluginRepositoryCopied`, `AzureSreAgentOpened`.
* The public GitHub repository (`owner/repo`) of the plugin being installed and
  whether a sub-path was used.
* Standard Application Insights ingestion metadata (timestamp, browser user
  agent, and a coarse, city-level location derived from your IP address; the IP
  address itself is not stored by Application Insights).

What is **never** collected: names, e-mail addresses, IP addresses, Azure
subscription or tenant identifiers, Azure credentials/tokens, the full page URL,
or free-text you type into the badge generator.

## Where data goes

Telemetry is sent directly from your browser to the Azure Application Insights
ingestion endpoint of this project and is retained according to that
resource's retention setting (90 days by default). It is used only in aggregate
to improve the site. Data is not sold or shared with third parties.

## Your rights

Because the collected data is anonymous and cannot be linked back to an
individual, we are unable to identify data belonging to a specific person. If
you do not want any data collected, decline analytics (or withdraw consent) -
that takes effect immediately. Questions? Open an issue in
[this repository](https://github.com/tomkerkhove/tomkerkhove-azure-sre-agent-plugin-installer/issues).

## Security note about credentials

Client-side telemetry can only use the Application Insights **ingestion
connection string**, which is write-only: it permits sending telemetry but not
reading data or managing Azure resources. Managed identity or Entra ID tokens
are deliberately **not** used, because any token delivered to a browser is
visible to every visitor. The connection string is injected at deploy time from
a repository secret and is never committed to this repository.
