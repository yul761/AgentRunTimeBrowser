# Agentability Audit Package Plan

This plan captures the known gaps for making `agentability-audit` a mature npm package and product surface. Every item below is treated as required work; ordering in this document is by work area, not priority.

## Implemented In The Current Package Pass

- Added observation backend request metadata and fallback-chain reporting.
- Added rule catalog APIs with `listRules()` and `getRule()`.
- Added rule severity overrides and suppressions in config.
- Added config validation for task names, backend names, and rule IDs.
- Added score/report metadata versioning.
- Added task probes for `auth_form`, `form`, `form_validation`, `modal`, `menu`, `filter`, `pagination`, `download`, and `table`.
- Added additional rules for action target identity, low-confidence actions, duplicate locator fingerprints, missing heading context, skipped probes, modal dismiss actions, and prompt-injection-like page text.
- Added Playwright context options for headers, storageState, and viewport.
- Added SARIF and JUnit report formatters.
- Added `defineConfig()` and `auditProject()` Node APIs.
- Added CLI commands: `init`, `rules`, `explain`, and `report`.
- Added CLI flags: `--backend`, `--artifact-dir`, `--storage-state`, `--sarif`, and `--junit`.
- Expanded package documentation for scores, caught issues, current limitations, multi-target Node API, and CI-oriented outputs.

## Audit Coverage

- Add a CDP Accessibility tree observation backend using `Accessibility.getFullAXTree`.
- Add a Playwright ARIA / AI snapshot observation backend using `locator.ariaSnapshot()` and Playwright's AI-oriented snapshot APIs where available.
- Keep DOM semantic extraction as a fallback backend, not the only production-quality observation path.
- Add backend selection to CLI and Node API, for example `observationBackend: "auto" | "cdp_ax_tree" | "playwright_aria" | "dom_semantic"`.
- Record the selected observation backend and fallback chain in every report.
- Add a rule catalog with stable `ruleId`, category, severity, rationale, examples, and fix guidance for every audit issue.
- Add rule severity overrides in config.
- Add rule suppressions with explicit reason strings.
- Add support for warning on unknown rule IDs in config.
- Add a versioned scoring model so score changes can be explained between releases.
- Add calibration fixtures for good, medium, and poor pages.
- Add tests that assert score ranges against calibration fixtures.

## Task Probes

- Add an `auth_form` probe for login-like forms without requiring real credentials by default.
- Add support for configured credentials through environment variables or Playwright `storageState`, never hardcoded values.
- Add a generic form submission probe.
- Add a form validation probe that submits incomplete data and checks for structured error feedback.
- Add a modal/dialog probe that opens and dismisses dialogs through semantic controls.
- Add menu and combobox probes.
- Add filter and sort probes for result-list pages.
- Add pagination probes.
- Add checkout-like multi-step form probes using configured fixture data.
- Add destructive-action confirmation probes that verify explicit confirmation semantics without executing real destructive actions by default.
- Add download probe support with safe download capture.
- Add file upload probe support using caller-provided fixture files.
- Add table interaction probes for sortable/selectable tables.
- Add task probe definitions in config so users can run only the flows relevant to their app.

## Audit Rules

- Detect ARIA role misuse, such as interactive roles on non-focusable elements.
- Detect missing or weak landmarks.
- Detect missing `main`/primary content boundaries.
- Detect missing status/live-region feedback after actions.
- Detect ambiguous repeated controls beyond buttons and links.
- Detect controls that are visually present but not keyboard/focus reachable.
- Detect controls that are disabled without structured reason text.
- Detect hidden or offscreen duplicate controls that pollute structured state.
- Detect icon-only controls without accessible names.
- Detect inputs with placeholders used as the only label.
- Detect form errors that are not associated with fields.
- Detect required fields that are not semantically marked.
- Detect tables without headers or meaningful row/column context.
- Detect lists/results without stable item names.
- Detect dialogs without title, dismiss action, or focus boundary.
- Detect cookie/consent dialogs that block primary tasks without clear actions.
- Detect sponsored/ads/native placement content that is not structurally distinguishable.
- Detect prompt-injection-like page text that asks agents to ignore developer/system/user instructions.
- Detect potential PII leakage in reports and expose redaction coverage evidence.
- Detect unstable semantic IDs across rerenders.
- Detect action graph actions without target element identity.
- Detect action effects that cannot be observed in state deltas.

## Runtime And Evidence

- Add replay artifacts for audit probes, including task inputs, executed actions, state IDs, state deltas, and normalized errors.
- Add network summaries to audit evidence.
- Add console summaries to audit evidence.
- Add per-step timings to audit evidence.
- Add optional trace capture using Playwright traces.
- Add optional screenshot artifacts only for human report review, not for audit decisions.
- Add artifact directory configuration.
- Add deterministic retry policy configuration.
- Add better timeout classification for navigation, action, assertion, and state-observation failures.
- Add support for frames with explicit support-level reporting.
- Add shadow DOM support with explicit support-level reporting.
- Add canvas semantic support reporting, even if the initial support level is `unsupported`.
- Add storage persistence only when users request it for report history; keep local-first behavior as default.

## Configuration

- Support multiple audit targets in one config file.
- Support URL arrays, local file paths, globs, and sitemap-derived targets.
- Support per-target task probes.
- Support per-target thresholds.
- Support global and per-target headers.
- Support cookies and Playwright `storageState`.
- Support viewport, device scale factor, user agent, locale, timezone, color scheme, and reduced-motion options.
- Support authenticated setup steps before running probes.
- Support include/exclude selectors for noisy page areas such as footer, ads, or decorative content.
- Support redaction patterns in config.
- Support report output directory and artifact naming templates.
- Support concurrency limits for multi-page audits.
- Support retries for flaky local preview environments.
- Support config schema validation with actionable validation messages.
- Export the config schema for editor tooling.

## CI And Reporting

- Add SARIF output for GitHub code scanning.
- Add JUnit output for CI systems.
- Add GitHub Actions annotations.
- Add a first-party GitHub Action wrapper.
- Add HTML report improvements for non-engineering product teams.
- Add a lightweight interactive report viewer for local artifacts.
- Add report diffing between two audit runs.
- Add trend-friendly JSON fields for dashboards.
- Add a sample report artifact to the repo.
- Add a command that opens the HTML report after generation.
- Add CI examples for GitHub Actions, Vercel preview deployments, Netlify previews, and generic npm scripts.
- Add failure-mode examples: score threshold failure, navigation failure, probe failure, and validation failure.

## Node API And SDK Experience

- Export a typed `defineConfig` helper.
- Export typed report formatter helpers.
- Export a typed rule metadata registry.
- Export lower-level functions for auditing an existing Playwright `Page`.
- Add `auditProject(config)` for multi-target configs.
- Add cancellation support through `AbortSignal`.
- Add progress/event callbacks for long audit runs.
- Add programmatic artifact writer helpers.
- Add clear ESM usage examples.
- Add Playwright Test integration examples.
- Add Express, Next.js, Vite, and generic Node examples.
- Add typed result narrowing helpers such as `hasBlockingIssues(report)`.
- Add stable public types without leaking internal `@arb/*` package imports.

## CLI Experience

- Add `agentability init` to create a config file.
- Add `agentability explain <ruleId>` to print rule rationale and fixes.
- Add `agentability rules` to list available rules.
- Add `agentability report <json>` to render existing JSON as HTML or Markdown.
- Add `--backend` for observation backend selection.
- Add `--target` support for named targets from config.
- Add `--storage-state`, `--header`, `--viewport`, and `--artifact-dir` flags.
- Add `--sarif` and `--junit` output flags.
- Add `--open` for HTML report output.
- Add clearer exit-code documentation.
- Add clearer install-time and runtime error messages when Playwright browsers are missing.

## Documentation

- Make the package README explain what each score means.
- Add a quick "read your first report" section.
- Add "what this catches" and "what this does not catch" sections.
- Add examples for common page types: search, login, form, modal, table, and checkout-like flow.
- Add a troubleshooting section for Playwright browser installation, blocked sites, auth, timeouts, and flaky local servers.
- Clarify that `agentability-audit` is the package name and `agentability` is the primary CLI binary.
- Add a direct npm install checklist.
- Add CI copy-paste examples.
- Add Playwright Test copy-paste examples.
- Add Next.js/Vite local preview examples.
- Add a privacy and redaction section with concrete patterns.
- Add a sample config file with comments.
- Add a sample report JSON and HTML artifact.
- Add a rule reference page.
- Add release and versioning notes for the scoring model.

## Package Publishing

- Verify package install in a clean project before every release.
- Keep `npm pack --dry-run` as a required release check.
- Add provenance-aware publish instructions.
- Add `prepublishOnly` verification if the release process moves beyond local manual publishing.
- Add package-size checks.
- Add Node version compatibility tests.
- Add a release checklist.
- Add changelog discipline for rule and scoring changes.
- Add npm package badges once the package is published.
