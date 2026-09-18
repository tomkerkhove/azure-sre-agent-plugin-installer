const fs = require("fs");
const path = require("path");

// Regression test for the light-to-dark flash: assets/theme-init.js applies
// the `theme` query parameter to `<html data-theme>` synchronously, before
// the browser has loaded the stylesheet or run assets/app.js. If it is ever
// moved after either of those, the requested theme will only apply once
// assets/app.js runs on `DOMContentLoaded` - after first paint - bringing
// back the flash.
describe.each(["index.html", "install.html"])(
  "%s theme-init.js script order",
  (file) => {
    const html = fs.readFileSync(
      path.join(__dirname, "../../", file),
      "utf8"
    );

    test("loads theme-init.js before the stylesheet and assets/app.js", () => {
      const themeInitIndex = html.indexOf('src="assets/theme-init.js"');
      const stylesheetIndex = html.indexOf('href="assets/style.css"');
      const appJsIndex = html.indexOf('src="assets/app.js"');

      expect(themeInitIndex).toBeGreaterThan(-1);
      expect(stylesheetIndex).toBeGreaterThan(-1);
      expect(appJsIndex).toBeGreaterThan(-1);
      expect(themeInitIndex).toBeLessThan(stylesheetIndex);
      expect(themeInitIndex).toBeLessThan(appJsIndex);
    });

    test("loads theme-init.js after the Content-Security-Policy meta tag", () => {
      // A meta-delivered CSP only applies to content that follows it in the
      // document, so theme-init.js must load after it to stay covered by
      // the policy - while still preceding the stylesheet and assets/app.js
      // (see the test above) to avoid the flash.
      const cspIndex = html.indexOf('http-equiv="Content-Security-Policy"');
      const themeInitIndex = html.indexOf('src="assets/theme-init.js"');

      expect(cspIndex).toBeGreaterThan(-1);
      expect(themeInitIndex).toBeGreaterThan(-1);
      expect(cspIndex).toBeLessThan(themeInitIndex);
    });
  }
);
