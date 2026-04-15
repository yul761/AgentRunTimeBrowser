# Changelog

## 0.1.0

- Initial alpha package shape for `agentability-audit`.
- Adds `agentability` CLI.
- Adds `auditUrl`, `auditHtml`, and `auditPage` Node APIs.
- Adds JSON, Markdown, and HTML report formatters.
- Adds local config loading for `agentability.config.{mjs,js,cjs,json}`.
- Adds DOM semantic observation backend with page and search probes.
- Adds expanded structured-state probes for auth forms, generic forms, validation feedback, modals, menus, filters, pagination, downloads, and table-like pages.
- Adds rule metadata APIs, rule severity overrides, and rule suppressions.
- Adds SARIF and JUnit report output for CI systems.
- Adds `defineConfig`, `auditProject`, and CLI commands for init, rules, explain, and report rendering.
- Adds native CDP Accessibility tree and Playwright ARIA/AI snapshot observation evidence.
- Adds replay evidence, DOM delta summaries, network summaries, console summaries, and per-probe timings.
- Adds `writeAuditReports`, `diffAuditReports`, `hasBlockingIssues`, and `validateConfig` SDK helpers.
- Adds CLI support for named config targets, headers, viewport, artifact directories, report diffing, config validation, and opening HTML reports.
- Adds first-party GitHub Action wrapper, sample config/report artifacts, and release checklist.
