# Agent guidelines

These instructions apply to every AI agent and automated contributor working in
this repository.

## Always add tests

Every change to behavior **must** be covered by automated tests:

* Changes to pure logic in [`assets/app.js`](./assets/app.js) require unit
  tests in [`tests/unit`](./tests/unit) (Jest).
* Changes to the rendered site ([`index.html`](./index.html), DOM wiring or
  user interactions) require UI tests in [`tests/e2e`](./tests/e2e)
  (Playwright).
* Bug fixes require a regression test that fails without the fix.
* If an existing test already covers the new behavior, extend it rather than
  duplicating it - but never ship behavior changes without test coverage.

Documentation-only changes (for example README or this file) do not require
new tests.

## Always run the tests

Before finishing a change, run:

```bash
npm install
npm test

npx playwright install --with-deps chromium
npm run test:e2e
```

Both suites also run in CI via
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) on every push and
pull request to `main`. Do not disable, skip or delete existing tests to make
a change pass.

## Conventions

* Follow semantic commit and pull request conventions
  (`feat:`, `fix:`, `docs:`, `ci:`, ...).
* Keep the site dependency-free at runtime: no backend, no build step.
* Never collect or store Azure access tokens in the static site; plugin
  imports are generated as local Azure CLI/curl commands.
