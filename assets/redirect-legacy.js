// Older generated badges point at the landing page (index.html) with a
// `repo` query parameter, from before the badge generator and install flow
// were split into separate pages. This script only loads on the landing
// page and runs as early as possible - before the rest of the page parses -
// so those visitors are sent to the dedicated install page without a flash
// of the wrong page content.
//
// This only checks that `repo` is present and non-blank; it intentionally
// doesn't duplicate the full `normalizeRepo` shape validation from app.js to
// stay dependency-free. install.html re-validates the repository and falls
// back to its own empty state for a malformed value, so an invalid `repo`
// here only costs an extra redirect hop, not incorrect behavior.
//
// Resolving the install page's filename is shared with assets/app.js via
// assets/install-page.js, which declares `getInstallPageUrl` as a global for
// other same-page scripts to call directly (all classic <script> tags share
// one top-level scope). In Node, requiring it here has the side effect of
// attaching that same global so this file's own use of `getInstallPageUrl`
// below, and its unit tests, work the same way.
if (typeof require === "function") {
  require("./install-page.js");
}

function buildInstallPageRedirectUrl(currentHref) {
  const current = new URL(currentHref);
  const target = new URL(getInstallPageUrl(current.href));
  target.search = current.search;
  return target.toString();
}

if (typeof window !== "undefined" && typeof window.location !== "undefined") {
  const params = new URLSearchParams(window.location.search);
  const repo = (params.get("repo") || "").trim();
  if (repo) {
    window.location.replace(buildInstallPageRedirectUrl(window.location.href));
  }
}

// Export the pure function for unit testing (Node/CommonJS) while keeping
// the browser bundle dependency-free.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildInstallPageRedirectUrl };
}
