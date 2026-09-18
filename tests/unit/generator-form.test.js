/** @jest-environment jsdom */

const { initGenerator } = require("../../assets/app.js");

function setUpGenerator() {
  document.body.innerHTML = `
    <form id="generator-form">
      <input id="gen-repo" />
      <input id="gen-path" />
      <select id="gen-theme"><option value="light" selected>Light</option></select>
      <button type="submit">Generate badge markdown</button>
      <button type="button" id="copy-badge-btn" aria-label="Copy badge markdown">Copy</button>
    </form>
    <p class="status error" id="generator-error" role="alert" hidden></p>
    <pre class="output" id="generator-output" role="status" aria-live="polite" hidden></pre>
  `;
  window.history.replaceState(null, "", "/index.html");
  initGenerator();
}

function submit() {
  document
    .getElementById("generator-form")
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

describe("badge generator accessibility", () => {
  test("reports an invalid repository in the alert region, not the output", () => {
    setUpGenerator();
    document.getElementById("gen-repo").value = "not-a-repository";

    submit();

    const error = document.getElementById("generator-error");
    const repoField = document.getElementById("gen-repo");
    expect(error.hidden).toBe(false);
    expect(error.textContent).toContain("Please enter a valid GitHub repository");
    expect(document.getElementById("generator-output").hidden).toBe(true);
    expect(repoField.getAttribute("aria-invalid")).toBe("true");
    expect(repoField.getAttribute("aria-describedby")).toBe("generator-error");
    expect(document.activeElement).toBe(repoField);
  });

  test("reports an invalid path on the path field", () => {
    setUpGenerator();
    document.getElementById("gen-repo").value = "owner/repo";
    document.getElementById("gen-path").value = "../../etc/passwd";

    submit();

    const pathField = document.getElementById("gen-path");
    expect(document.getElementById("generator-error").textContent).toContain(
      "Please enter a valid path within the repository"
    );
    expect(pathField.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(pathField);
  });

  test("clears the error state and shows the markdown for valid input", () => {
    setUpGenerator();
    const repoField = document.getElementById("gen-repo");
    repoField.value = "not-a-repository";
    submit();

    repoField.value = "owner/repo";
    submit();

    const output = document.getElementById("generator-output");
    expect(document.getElementById("generator-error").hidden).toBe(true);
    expect(repoField.hasAttribute("aria-invalid")).toBe(false);
    expect(output.hidden).toBe(false);
    expect(output.textContent).toContain("[![Install to Azure SRE Agent]");
  });
});
