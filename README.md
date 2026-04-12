# Agent Runtime Browser

Agent Runtime Browser is a structured browser execution environment for agents. It accepts structured tasks, executes them in a real browser, and returns structured state and results without relying on vision as the primary interaction model.

This is not a chat agent, not a natural-language browser assistant, not a vision-first browser agent, and not a generic wrapper around Playwright. Playwright is an internal browser engine dependency; the public product interface is the runtime task protocol plus the `arb` CLI.

## Architecture

```text
External agent / CLI
        |
        v
Runtime API: POST /tasks, GET /tasks/:id, state, logs, snapshot
        |
        v
Task Runtime Layer: validation, deterministic planning, step execution, logs
        |
        v
Driver Layer: openPage, click, fill, press, waitFor, extractText, getStructuredState
        |
        v
Browser Engine Layer: Playwright-controlled Chromium

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
curl http://localhost:8787/tasks/<taskId>/logs
curl http://localhost:8787/tasks/<taskId>/snapshot
```

The snapshot endpoint exists for the human monitor UI only. Screenshots are not used as the task understanding or execution interface.

## CLI

```bash
pnpm arb submit --file ./examples/google-search.json
pnpm arb tasks
pnpm arb task <taskId>
pnpm arb state <taskId>
pnpm arb logs <taskId>
```

Use another API URL:

```bash
pnpm arb --api-url http://localhost:8787 tasks
```

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

## MVP Complete

- Structured task submission and validation.
- Playwright Chromium execution behind a driver interface.
- Step-by-step deterministic execution with logs and status.
- Structured page state extraction for headings, buttons, inputs, links, forms, visible text summary, and available action candidates.
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
