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
      <p id="plugin-details-error" role="alert" hidden></p>
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

  test("links the validation message to the offending field and focuses it", () => {
    setUpForm();
    document.getElementById("plugin-repo").value = "not-a-repository";

    document
      .getElementById("plugin-details-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    const repoField = document.getElementById("plugin-repo");
    expect(repoField.getAttribute("aria-invalid")).toBe("true");
    expect(repoField.getAttribute("aria-describedby")).toBe(
      "plugin-details-error"
    );
    expect(document.activeElement).toBe(repoField);
  });

  test("clears the error state once the details are valid", () => {
    setUpForm();
    const repoField = document.getElementById("plugin-repo");
    repoField.value = "not-a-repository";
    const form = document.getElementById("plugin-details-form");
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    repoField.value = "owner/repo";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(repoField.hasAttribute("aria-invalid")).toBe(false);
    expect(repoField.hasAttribute("aria-describedby")).toBe(false);
    expect(document.getElementById("plugin-details-error").hidden).toBe(true);
  });

  test("keeps unrelated descriptions on the field", () => {
    setUpForm();
    const pathField = document.getElementById("plugin-path");
    pathField.setAttribute("aria-describedby", "plugin-path-hint");
    document.getElementById("plugin-repo").value = "owner/repo";
    pathField.value = "plugins/my-plugin";

    document
      .getElementById("plugin-details-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(pathField.getAttribute("aria-describedby")).toBe("plugin-path-hint");
  });

  test("appends the error to an existing description and removes only it", () => {
    setUpForm();
    const pathField = document.getElementById("plugin-path");
    pathField.setAttribute("aria-describedby", "plugin-path-hint");
    const form = document.getElementById("plugin-details-form");

    document.getElementById("plugin-repo").value = "owner/repo";
    pathField.value = "../../etc/passwd";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(pathField.getAttribute("aria-describedby")).toBe(
      "plugin-path-hint plugin-details-error"
    );

    pathField.value = "plugins/my-plugin";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(pathField.getAttribute("aria-describedby")).toBe("plugin-path-hint");
  });

  test("does not duplicate the error description across submissions", () => {
    setUpForm();
    const repoField = document.getElementById("plugin-repo");
    const form = document.getElementById("plugin-details-form");
    repoField.value = "not-a-repository";

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(repoField.getAttribute("aria-describedby")).toBe(
      "plugin-details-error"
    );
  });

  test("does not wire up the form when the alert region is missing", () => {
    document.body.innerHTML = `
      <section id="install-card" hidden></section>
      <section id="empty-state">
        <form id="plugin-details-form">
          <input id="plugin-repo" />
          <input id="plugin-path" />
        </form>
      </section>
    `;
    window.history.replaceState(null, "", "/install.html");
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    initPluginDetailsForm();

    document.getElementById("plugin-repo").value = "owner/repo";
    document
      .getElementById("plugin-details-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(document.getElementById("install-card").hidden).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("#plugin-details-error is missing")
    );
    warn.mockRestore();
  });
});
