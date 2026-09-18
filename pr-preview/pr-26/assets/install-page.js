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
// same-page scripts (assets/app.js, assets/redirect-legacy.js) can call
// directly. In Node, those same scripts require this file for its side
// effect of attaching `getInstallPageUrl` to `global`, so they can call it
// the same way without each maintaining their own require/global wrapper.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getInstallPageUrl };
  if (typeof global !== "undefined") {
    global.getInstallPageUrl = getInstallPageUrl;
  }
}
