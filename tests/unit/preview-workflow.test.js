const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const workflow = readFileSync(
  join(__dirname, "../../.github/workflows/pr-preview.yml"),
  "utf8"
);

describe("PR preview workflow", () => {
  test("runs from the trusted base workflow for supported pull request events", () => {
    expect(workflow).toMatch(
      /pull_request_target:\s*\n\s+types: \[opened, reopened, synchronize, closed\]/
    );
    expect(workflow).not.toMatch(/\n\s+pull_request:\s*\n/);
  });

  test("checks out the exact pull request revision without persisting credentials", () => {
    expect(workflow).toMatch(
      /if: github\.event\.action != 'closed'[\s\S]*ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}[\s\S]*persist-credentials: false/
    );
  });

  test("uses the trusted default checkout before cleanup", () => {
    expect(workflow).toMatch(
      /name: Checkout base for cleanup\s+if: github\.event\.action == 'closed'\s+uses: actions\/checkout@v7\s+with:\s+persist-credentials: false/
    );
  });

  test("deploys only same-repository changes but allows cleanup for every PR", () => {
    expect(workflow).toContain(
      "if: github.event.action == 'closed' || github.event.pull_request.head.repo.full_name == github.repository"
    );
  });
});
