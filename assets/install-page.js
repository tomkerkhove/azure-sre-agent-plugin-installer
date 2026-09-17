// Shared helper for resolving the dedicated install page's URL. Used by both
// the badge generator (assets/app.js) and the legacy badge redirect
// (assets/redirect-legacy.js) so the "install.html" filename only lives in
// one place.
function getInstallPageUrl(currentHref) {
  return new URL("install.html", currentHref).toString();
}

// Export the pure function for unit testing (Node/CommonJS) while keeping
// the browser bundle dependency-free: in the browser this file is loaded via
// a plain <script> tag, so `getInstallPageUrl` becomes a global that other
// same-page scripts can call directly.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getInstallPageUrl };
}
