# Agentability Audit

Agentability Audit is a local-first toolkit for measuring whether owned websites, staging apps, internal tools, and agent-friendly web flows expose enough structured semantics, executable actions, state feedback, and evidence for trusted AI agents to complete tasks reliably.

The project includes a browser runtime engine, but the product purpose is audit: run deterministic browser probes, collect structured page state, score the page, and return actionable issues for web teams.

This is not a chat agent, not a natural-language browser assistant, not a vision-first browser agent, and not a tool for bypassing sites that block automation. It is for consent-based agent access: teams that want their own web apps or customer-facing flows to be understandable, safe, and debuggable for trusted agents.

Screenshots are only used for human observation in the monitor UI. The default audit path reads structured browser state and inferred actions rather than using vision as the primary interaction model.

## What It Does

As a package:

```bash
npm install -D agentability-audit playwright
npx playwright install chromium
npx agentability audit http://localhost:3000 --task page,search --fail-below 80
```

As this repo:

```bash
pnpm arb audit ./baseline/search-fixture.html --task page,search
```

The audit command opens the page in Chromium, extracts structured browser state, runs optional task probes, and reports:

- Overall Agentability score.
- Semantic discoverability score.
- Actionability score.
- State feedback score.
- Recoverability score.
- Agent safety score.
- Task probe results.
- Prioritized issues with evidence and repair guidance.

Example output:

```text
Agentability audit for file:///.../baseline/search-fixture.html#results
Overall score: 88/100

Task probes:
- page: passed steps=1 effects=structured_state_captured
- search: passed steps=2 effects=url_changed,results_region_detected

Issues:
- [medium] actionability: Duplicate button labels make actions ambiguous
  Fix: Include the object name in repeated controls, for example aria-label="View details for Ramen DANBO".
```

## Architecture

```text
arb audit / CI / local developer
        |
        v
Agentability Audit Layer: scoring, issues, probes, report output
        |
        v
Browser Runtime Engine: deterministic steps, state deltas, logs, evidence
        |
        v
Driver Layer: openPage, click, fill, press, waitFor, extractText, getStructuredState
        |
        v
Browser Engine Layer: Playwright-controlled Chromium

Structured state includes semantic elements, action graph, intent regions, and state IDs.
The probe inspection API and monitor UI remain available as developer tools for inspecting lower-level execution.
```

## Workspace

```text
packages/audit         Agentability scoring, issue generation, and task probes
packages/browser-driver Playwright-backed browser driver abstraction
packages/task-engine   Deterministic runtime engine for structured probes
packages/schemas       Zod task/result/state/error/audit schemas
packages/core          In-memory task store, state delta, profiling, error helpers
packages/cli           arb CLI, including arb audit
apps/runtime-api       Optional Express API for inspecting probe execution
apps/monitor-ui        Optional React + Vite monitor UI for execution observation
baseline               Baseline LLM browser agent and benchmark fixtures
examples               Structured runtime task examples
```

## Setup

```bash
pnpm install
pnpm test
pnpm typecheck
```

Install Playwright Chromium if it is not already present:

```bash
pnpm exec playwright install chromium
```

Set `ARB_HEADLESS=false` to show the Playwright-controlled Chromium window during local audit runs.

## Audit CLI

For npm users, run the published package CLI as `agentability`:

```bash
npm install -D agentability-audit playwright
npx agentability audit https://example.com --task page,search
# or, for one-off package execution:
npx agentability-audit audit https://example.com --task page,search
```

For repo development, use the workspace CLI:

Run a basic page audit:

```bash
pnpm arb audit https://example.com
```

Run a local fixture audit with a deterministic search probe:

```bash
pnpm arb audit ./baseline/search-fixture.html --task page,search
```

Save a full JSON report:

```bash
pnpm arb audit ./baseline/search-fixture.html \
  --task page,search \
  --out benchmark-results/audit-fixture.json
```

Print JSON to stdout:

```bash
pnpm arb audit ./baseline/search-fixture.html --task page,search --json
```

Write HTML and Markdown reports:

```bash
pnpm agentability audit ./baseline/search-fixture.html \
  --task page,search \
  --html benchmark-results/audit-fixture.html \
  --markdown benchmark-results/audit-fixture.md
```

Use it as a CI gate:

```bash
pnpm arb audit https://preview.example.com --task page,search --fail-below 80
```

Node API:

```ts
import { auditUrl } from "agentability-audit";

const report = await auditUrl("http://localhost:3000", {
  tasks: ["page", "search"],
  searchQuery: "Richmond ramen"
});
```

Use an existing Playwright page:

```ts
import { auditPage } from "agentability-audit";

await page.goto("http://localhost:3000");
const report = await auditPage(page, { tasks: ["page"] });
```

Current MVP task probes:

- `page`: captures structured state and checks whether meaningful elements/actions are exposed.
- `search`: finds a search-like input, fills a query, submits it, and checks for structured state feedback.

Current MVP scoring dimensions:

- `semanticDiscoverability`: agents can find labels, roles, headings, forms, and regions.
- `actionability`: executable controls can be inferred without ambiguous labels.
- `stateFeedback`: task probes can observe useful URL, title, text, or region changes after actions.
- `recoverability`: exposed elements have semantic IDs, locator fingerprints, and lineage.
- `agentSafety`: paid or risky content should be distinguishable from primary task content.

## Optional Probe Inspection Tools

The inspection API is still available for lower-level debugging and for external agents that need structured browser execution. It is not the primary product surface.

Start the API only:

```bash
pnpm dev
```

Start the API and monitor UI:

```bash
pnpm arb dev
```

Default URLs:

```text
Probe inspection API: http://localhost:8787
Monitor UI: http://localhost:5173
```

Submit and inspect structured probe tasks:

```bash
pnpm arb submit --file ./examples/google-search.json
pnpm arb tasks
pnpm arb task <taskId>
pnpm arb state <taskId>
pnpm arb logs <taskId>
```

Probe inspection API endpoints:

```bash
curl http://localhost:8787/health
curl http://localhost:8787/capabilities
curl http://localhost:8787/tasks
curl http://localhost:8787/tasks/<taskId>
curl http://localhost:8787/tasks/<taskId>/state
curl 'http://localhost:8787/tasks/<taskId>/state?profile=minimal'
curl 'http://localhost:8787/tasks/<taskId>/state-delta?since=<stateId>'
curl http://localhost:8787/tasks/<taskId>/logs
curl http://localhost:8787/tasks/<taskId>/evidence
curl http://localhost:8787/tasks/<taskId>/snapshot
```

The snapshot endpoint exists for the human monitor UI only. Screenshots are not used as the primary state or action interface.

## Structured Browser Primitives

Audit reports and runtime probes are built on structured browser state:

- `stateId`: observation ID for deltas and evidence.
- Stable semantic identity on each exposed element: `elementInstanceId`, `semanticElementId`, `locatorFingerprint`, and `lineage`.
- `actionGraph.actions`: inferred executable actions such as `click`, `submit_form`, `open_link`, `toggle`, `focus`, `download`, and `dismiss_dialog`.
- `regions`: intent-level groups such as `search_interface`, `auth_form`, `results_list`, `navigation_bar`, `modal_dialog`, `primary_content`, and `secondary_content`.
- Observation profiles: `minimal`, `interactive_only`, `form_mode`, `navigation_mode`, and `full`.
- Step evidence: completed runtime steps can record before/after state IDs, observed effects, DOM delta summary, network summary, console summary, and assertion evidence.

## Benchmarking

The repo includes a baseline LLM browser agent for comparison against the deterministic structured runtime engine:

```bash
pnpm baseline
pnpm compare
```

`pnpm baseline` runs one target selected by `BASELINE_TARGET` (`google`, `fixture`, `complex_fixture`, or `live_web`) and writes `benchmark-results/baseline.json`.

`pnpm compare` runs the baseline agent plus two runtime modes:

- `runtime_observed`: captures preview snapshots and step evidence.
- `runtime_lean`: skips preview snapshots and step evidence for lower fixed overhead.

Use a smaller matrix:

```bash
COMPARE_TARGETS=complex_fixture,live_web pnpm compare
```

## Runtime Task Protocol

This protocol is a lower-level engine interface used by audit probes and external structured agents.

Task types:

- `workflow.execute`: caller provides explicit steps.
- `web.search`: caller provides `{ "engine": "google", "query": "..." }`; the engine translates this into deterministic internal workflow steps without an LLM.

Actions:

- `navigate`
- `click`
- `fill`
- `press`
- `waitFor`
- `extract`
- `assert`

Preferred target forms:

- `{ "kind": "role", "role": "button", "name": "Search" }`
- `{ "kind": "label", "value": "Email" }`
- `{ "kind": "text", "value": "Results" }`
- `{ "kind": "testId", "value": "submit" }`

CSS targets are supported as an internal fallback, not as the preferred public path.

Task submissions can include optional runtime execution settings:

```json
{
  "taskType": "workflow.execute",
  "runtime": {
    "capturePreview": false,
    "captureEvidence": false,
    "observationProfile": "interactive_only"
  },
  "input": {
    "steps": [{ "action": "navigate", "url": "https://example.com" }]
  }
}
```

## MVP Complete

- Agentability audit CLI with scoring, task probes, issue generation, JSON output, and CI threshold support.
- Structured task submission and validation for the runtime engine.
- Playwright Chromium execution behind a driver interface.
- Step-by-step deterministic execution with logs and status.
- Structured page state extraction for headings, buttons, inputs, links, forms, visible text summary, and available action candidates.
- Action graph generation, stable semantic element identity, intent regions, state profiles, task-scoped state query, state delta API, and step evidence.
- Baseline LLM browser agent and comparison benchmark.
- Express API and React monitor UI for runtime inspection.

## Intentionally Left Out

- Hosted audit service.
- Interactive hosted audit report viewer.
- GitHub Action wrapper.
- LLM planning or fallback in the audit path.
- Free-form natural language as the main interface.
- Chat-with-browser UX.
- Vision-first page understanding.
- Bypassing automation blocks on sites that do not consent to agent access.
- Persistent database storage.
- Cloud, distributed workers, multi-tenant auth, and remote browser pools.
- Full embedded browser streaming. The MVP uses latest snapshot preview for observation.

## Recommended v2

The full required work plan for turning the audit package into a mature npm package is tracked in [docs/audit-package-plan.md](docs/audit-package-plan.md). It covers audit coverage, task probes, rule depth, runtime evidence, configuration, CI outputs, Node API ergonomics, CLI commands, documentation, and publishing checks.
