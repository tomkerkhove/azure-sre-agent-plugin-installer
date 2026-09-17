window.SRE_AGENT_INSTALLER_CONFIG = Object.freeze({
  clientId: "",
  tenantId: "organizations",
  dataPlaneScope: "https://azuresre.dev/.default",
});

// Runtime configuration for the static site.
//
// `connectionString` is intentionally empty in source control. The GitHub Pages
// deployment workflow overwrites this file with the Application Insights
// *ingestion* connection string stored in the `APPLICATIONINSIGHTS_CONNECTION_STRING`
// repository secret.
//
// Notes:
//   * The ingestion connection string only allows *writing* telemetry - it can
//     never be used to read data or manage Azure resources. That is the only
//     credential that can be used from a browser; API keys, Entra ID tokens or
//     managed identities must never be placed in client-side code.
//   * Because the site is fully static, telemetry is disabled automatically when
//     no connection string is configured (for example on local checkouts).
window.SITE_CONFIG = {
  telemetry: {
    connectionString: "",
    cloudRole: "sre-agent-plugin-installer",
  },
};
