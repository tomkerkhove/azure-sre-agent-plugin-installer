/** @jest-environment jsdom */

const { initPluginDetailsForm } = require("../../assets/app.js");

function setUpForm() {
  document.body.innerHTML = `
    <section id="install-card" hidden></section>
    <section id="empty-state">
      <form id="plugin-details-form">
        <input id="plugin-repo" />
        <input id="plugin-path" />
      </form>
      <p id="plugin-details-error" hidden></p>
    </section>
  `;
  window.history.replaceState(null, "", "/install.html");
  initPluginDetailsForm();
}

describe("manual plugin details form", () => {
  test("renders the install flow for valid plugin details", () => {
    setUpForm();
    document.getElementById("plugin-repo").value =
      "https://github.com/owner/repo";
    document.getElementById("plugin-path").value = "plugins/my-plugin";

    document
      .getElementById("plugin-details-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(document.getElementById("empty-state").hidden).toBe(true);
    expect(document.querySelector("#install-card h2 span").textContent).toBe(
      "owner/repo"
    );
    expect(window.location.search).toBe(
      "?repo=owner%2Frepo&path=plugins%2Fmy-plugin"
    );
  });

  test("renders the install flow without an optional path", () => {
    setUpForm();
    document.getElementById("plugin-repo").value = "owner/repo";

    document
      .getElementById("plugin-details-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(document.getElementById("empty-state").hidden).toBe(true);
    expect(window.location.search).toBe("?repo=owner%2Frepo");
    expect(document.querySelectorAll("#install-card dt")).toHaveLength(1);
  });

  test("keeps the form visible and reports invalid details", () => {
    setUpForm();
    document.getElementById("plugin-repo").value = "owner/repo";
    document.getElementById("plugin-path").value = "../../etc/passwd";

    document
      .getElementById("plugin-details-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(document.getElementById("empty-state").hidden).toBe(false);
    expect(document.getElementById("install-card").hidden).toBe(true);
    expect(document.getElementById("plugin-details-error").textContent).toContain(
      "Please enter a valid path"
    );
  });
});
