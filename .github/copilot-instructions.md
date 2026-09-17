# Copilot instructions

Follow the repository's [agent guidelines](../AGENTS.md).

Key rule: **always add or update automated tests for every behavior change** -
Jest unit tests in `tests/unit` for logic in `assets/app.js`, and Playwright UI
tests in `tests/e2e` for anything affecting the rendered site. Run `npm test`
and `npm run test:e2e` before finishing, and never skip or delete existing
tests to make a change pass.
