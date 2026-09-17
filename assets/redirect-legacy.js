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
// Note: the "install.html" filename is also referenced by
// `getInstallPageUrl` in assets/app.js - keep both in sync if the install
// page is ever renamed.

function buildInstallPageRedirectUrl(currentHref) {
  const current = new URL(currentHref);
  const target = new URL("install.html", current);
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
