# Agent Runtime Browser

Agent Runtime Browser is a structured browser execution environment for agents. It accepts structured tasks, executes them in a real browser, and returns structured state and results without relying on vision as the primary interaction model.

It is also a browser-native agent interface layer: it exposes page state, inferred actions, stable semantic element identity, and state transitions as structured primitives for agents.

The project is evolving toward Agentability Audit: a local-first toolkit for measuring whether owned websites, staging apps, and agent-friendly web flows expose enough semantics, executable actions, state feedback, and evidence for AI agents to complete tasks reliably.

This is not a chat agent, not a natural-language browser assistant, not a vision-first browser agent, and not a generic wrapper around Playwright. Playwright is an internal browser engine dependency; the public product interface is the runtime task protocol plus the `arb` CLI.

This project is not meant to bypass sites that block automation. It is for consent-based agent access: teams that want their own web apps or customer-facing flows to be understandable, safe, and debuggable for trusted agents.

## Architecture

```text
External agent / CLI
        |
        v
Runtime API: tasks, capabilities, state profiles, state deltas, evidence, snapshot
        |
        v
Task Runtime Layer: validation, deterministic planning, step execution, evidence
        |
        v
Driver Layer: openPage, click, fill, press, waitFor, extractText, getStructuredState
        |
        v
Browser Engine Layer: Playwright-controlled Chromium

Structured state includes semantic elements, action graph, intent regions, and state IDs.
Monitor UI polls the Runtime API for task progress, logs, structured state, extracted data,
and a human-only preview snapshot.
```

## Workspace

```text
apps/runtime-api       Express runtime API
apps/monitor-ui        React + Vite monitor UI
packages/schemas       Zod task/result/state/error schemas
packages/core          In-memory task store and runtime error helpers
packages/browser-driver Playwright-backed browser driver abstraction
packages/task-engine   Deterministic task executor
packages/cli           arb CLI
examples               Structured task examples
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
Runtime API: http://localhost:8787
Monitor UI: http://localhost:5173
```

Set `ARB_HEADLESS=false` to show the Playwright-controlled Chromium window during local runs.

## Runtime API

Submit a deterministic web search:

```bash
curl -X POST http://localhost:8787/tasks \
  -H 'content-type: application/json' \
  --data @examples/google-search.json
```

Submit an explicit workflow:

```bash
curl -X POST http://localhost:8787/tasks \
  -H 'content-type: application/json' \
  --data @examples/extract-headings.json
```

Inspect runtime state:

```bash
curl http://localhost:8787/tasks
curl http://localhost:8787/tasks/<taskId>
curl http://localhost:8787/tasks/<taskId>/state
curl 'http://localhost:8787/tasks/<taskId>/state?profile=minimal'
curl 'http://localhost:8787/tasks/<taskId>/state-delta?since=<stateId>'
curl http://localhost:8787/tasks/<taskId>/logs
curl http://localhost:8787/tasks/<taskId>/evidence
curl http://localhost:8787/tasks/<taskId>/snapshot
curl http://localhost:8787/capabilities
```

The snapshot endpoint exists for the human monitor UI only. Screenshots are not used as the task understanding or execution interface.

Query a task-scoped view of the latest state:

```bash
curl -X POST http://localhost:8787/state/query \
  -H 'content-type: application/json' \
  --data '{
    "taskHint": "login",
    "include": ["forms", "buttons", "errors", "navigation"],
    "exclude": ["footer", "ads", "decorative"],
    "profile": "form_mode"
  }'
```

## CLI

```bash
pnpm arb submit --file ./examples/google-search.json
pnpm arb tasks
pnpm arb task <taskId>
pnpm arb state <taskId>
pnpm arb logs <taskId>
pnpm arb audit https://example.com
pnpm arb audit ./baseline/search-fixture.html --task page,search --out benchmark-results/audit-fixture.json
```

Use another API URL:

```bash
pnpm arb --api-url http://localhost:8787 tasks
```

## Benchmarking

The repo includes a baseline LLM browser agent for comparison against the structured runtime:

```bash
pnpm baseline
pnpm compare
```

`pnpm baseline` runs one target selected by `BASELINE_TARGET` (`google`, `fixture`, `complex_fixture`, or `live_web`) and writes `benchmark-results/baseline.json`.

`pnpm compare` runs the baseline agent plus two runtime modes:

- `runtime_observed`: captures preview snapshots and step evidence.
- `runtime_lean`: skips preview snapshots and step evidence for lower fixed overhead.

Use `COMPARE_TARGETS=complex_fixture,live_web pnpm compare` to run a smaller matrix.

## Agentability Audit

`arb audit` checks whether a page is structurally ready for AI-agent use. It reads the runtime's structured browser state, scores the page, runs optional deterministic probes, and emits issues with evidence and repair guidance.

Current MVP scoring dimensions:

- Semantic discoverability: agents can find labels, roles, headings, forms, and regions.
- Actionability: executable controls can be inferred without ambiguous labels.
- State feedback: task probes can observe useful URL, title, text, or region changes after actions.
- Recoverability: exposed elements have semantic IDs, locator fingerprints, and lineage.
- Agent safety: paid or risky content should be distinguishable from primary task content.

Example:

```bash
pnpm arb audit ./baseline/search-fixture.html --task page,search
```

Output includes an overall score, category scores, task probe results, and prioritized issues such as duplicate button names or missing labels. Use `--json` for the full report or `--out <path>` to save it.

## Task Protocol

MVP task types:

- `workflow.execute`: caller provides explicit steps.
- `web.search`: caller provides `{ "engine": "google", "query": "..." }`; the runtime translates this into deterministic internal workflow steps without an LLM.

MVP actions:

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

The lean runtime mode is intended for agent-to-runtime execution where the agent needs structured state and results but does not need a human preview snapshot for every step.

## Browser-Native Agent Primitives

Structured state includes more than element lists:

- `stateId`: runtime observation ID for deltas and evidence.
- Stable semantic identity on each exposed element: `elementInstanceId`, `semanticElementId`, `locatorFingerprint`, and `lineage`.
- `actionGraph.actions`: inferred executable actions such as `click`, `submit_form`, `open_link`, `toggle`, `focus`, `download`, and `dismiss_dialog`.
- `regions`: intent-level groups such as `search_interface`, `auth_form`, `results_list`, `navigation_bar`, `modal_dialog`, `primary_content`, and `secondary_content`.
- Observation profiles: `minimal`, `interactive_only`, `form_mode`, `navigation_mode`, and `full`.
- Step evidence: each completed step records before/after state IDs, observed effects, DOM delta summary, network summary, console summary, and assertion evidence.

The runtime infers these primitives from page structure and interactivity. It does not use screenshots as the primary state or action interface.

## Implementation Priority

Current MVP priorities:

- Schemas.
- Browser driver abstraction.
- Task engine for `workflow.execute`.
- Runtime API.
- CLI.
- Structured state extraction.
- Monitor UI.
- Deterministic `web.search`.
- Stable semantic identity.
- Action graph generation.
- State delta API.
- Intent regions.
- Task-scoped state.

## MVP Complete

- Structured task submission and validation.
- Playwright Chromium execution behind a driver interface.
- Step-by-step deterministic execution with logs and status.
- Structured page state extraction for headings, buttons, inputs, links, forms, visible text summary, and available action candidates.
- Action graph generation, stable semantic element identity, intent regions, state profiles, task-scoped state query, state delta API, and step evidence.
- Structured task results, extracted data, and normalized runtime errors.
- Express API, `arb` CLI, React monitor UI, and example tasks.

## Intentionally Left Out

- LLM planning or fallback.
- Free-form natural language as the main interface.
- Chat-with-browser UX.
- Vision-first page understanding.
- Persistent database storage.
- Cloud, distributed workers, multi-tenant auth, and remote browser pools.
- Full embedded browser streaming. The MVP uses latest snapshot preview for observation.

## Recommended v2

- Replace the in-memory task store with SQLite or Postgres.
- Add task cancellation and browser session retention controls.
- Add an event stream for UI updates instead of polling.
- Add richer structured extraction for tables, menus, dialogs, and ARIA landmarks.
- Add replay artifacts with deterministic step inputs, state deltas, and network summaries.
- Add typed SDK clients for external agents.
- Harden stable semantic identity across frames, shadow DOM, SPA transitions, and long-lived sessions.
