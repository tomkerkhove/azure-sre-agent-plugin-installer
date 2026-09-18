# Privacy statement

This site is a static page hosted on GitHub Pages. It has no backend, no user
accounts and no login. To understand adoption (how many people use the site,
which scenarios they use and which plugins get installed) it can send anonymous
usage analytics to [Azure Application Insights](https://learn.microsoft.com/azure/azure-monitor/app/app-insights-overview).

## Regional consent

* For visitors with a European browser time zone, analytics are **off by
  default**. Nothing is sent until you press **Allow analytics** in the banner.
* Outside Europe, analytics start without showing the banner when first-party
  preference storage is available.
* If preference storage is unavailable, or the browser time zone is unavailable
  or not known to be outside Europe, analytics remain off and the site asks for
  consent.
* Choosing **Decline** stops all telemetry; the choice is remembered in
  `localStorage`, or for the current tab in `sessionStorage` when local storage
  is unavailable (strictly functional, first-party entries, not cookies).
* You can change your choice at any time through **Change privacy choice** in
  the page footer.

The site determines whether to ask from the IANA time zone reported by the
browser. This happens locally: the site does not make an IP geolocation request
or share data with another service to determine the region. Time zones are only
an approximation of location and can be affected by device settings or travel.
To avoid collecting before consent when the result is unclear, UTC,
fixed-offset, unrecognized, missing and unreadable time zones require consent.

## No cookies

The site sets **no cookies** and loads no third-party scripts, advertising or
social media widgets. The following first-party browser storage entries are used:

| Key | Storage | Purpose |
| --- | --- | --- |
| `sre-agent-plugin-installer.analytics-consent` | `localStorage`, or `sessionStorage` fallback | Remembers your privacy choice. |
| `sre-agent-plugin-installer.analytics-consent-probe` | `localStorage` or `sessionStorage` | Temporarily verifies that a privacy choice can be stored. It contains no consent choice and is removed immediately when storage permits. |
| `sre-agent-plugin-installer.session-id` | `sessionStorage` | Random per-tab identifier used to group events of a single visit. Cleared when the tab closes and when consent is withdrawn. |
| `sre-agent-plugin-installer.readme.<owner/repo>` | `sessionStorage` | Caches a sanitized, rendered public repository README to avoid repeated GitHub requests. Cleared when the tab closes. |

## What is collected

When analytics are enabled, only these fields are collected:

* A page view with the scenario (`plugin-install` or `badge-generator`).
* Events describing what happened: `BadgeGenerated`, `BadgeMarkdownCopied`,
  `BadgeGenerationFailed`, `PluginRepositoryCopied`, `AzureSreAgentOpened`.
* The public GitHub repository (`owner/repo`) of the plugin being installed and
  whether a sub-path was used.
* A `PluginInstalls` custom metric, with that public repository name as a
  dimension, so installs can be counted per plugin.
* Application exception occurrences, including an allowlisted exception
  category, whether it was handled, the operation where it occurred and, for
  API failures, the HTTP status code. Exception messages and stack traces are
  discarded in the browser and are never sent.
* Standard Application Insights ingestion metadata (timestamp, browser user
  agent, and a coarse, city-level location derived from your IP address). IP
  masking is left at its Azure default, so the IP address is used to derive that
  location and is then discarded rather than stored.

This data is **pseudonymous** rather than fully anonymous: the random session
identifier, user agent and coarse location relate to a visit rather than to a
person, but they are still personal data under the GDPR. Microsoft acts as the
data processor for the Azure Application Insights resource.

What is **never** stored: names, e-mail addresses, IP addresses, Azure
subscription or tenant identifiers, Azure credentials/tokens, the full page URL,
exception messages, stack traces, or free-text you type into the badge generator.

## Third-party content

The installer pages' branding, icons and social-preview images are served from
this site's own GitHub Pages origin. They do not make third-party requests.

When a public plugin repository is selected, the browser requests its rendered
README from the [GitHub API](https://docs.github.com/rest/repos/contents#get-a-repository-readme)
before any privacy choice is made. GitHub receives the requested public
repository name, IP address and browser user agent. Images allowed by the
sanitizer can also be loaded from GitHub, GitHub's content hosts or shields.io;
image requests are made without a referrer. The sanitized README is cached only
in the current tab's `sessionStorage` and is not sent to this site's analytics.
No third-party scripts or trackers are used.

## Where data goes

Telemetry is sent directly from your browser to the Azure Application Insights
ingestion endpoint of this project and is retained according to that
resource's retention setting (90 days by default). It is used only in aggregate
to improve the site. Data is not sold or shared with third parties.

## Your rights

The collected data contains no identifiers that let us link a visit back to an
individual, so we are generally unable to locate data belonging to a specific
person for access or erasure requests. If
you do not want any data collected, decline analytics (or withdraw consent) -
that takes effect immediately. Questions? Open an issue in
[this repository](https://github.com/tomkerkhove/azure-sre-agent-plugin-installer/issues).

## Security note about credentials

Client-side telemetry can only use the Application Insights **ingestion
connection string**, which is write-only: it permits sending telemetry but not
reading data or managing Azure resources. Managed identity or Entra ID tokens
are deliberately **not** used, because any token delivered to a browser is
visible to every visitor. The connection string is injected at deploy time from
a repository secret and is never committed to this repository.
