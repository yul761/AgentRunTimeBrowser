# agentability-audit

Local-first Agentability Audit toolkit for testing whether web flows expose enough structured semantics, executable actions, state feedback, and evidence for trusted AI agents.

It is not a browser agent and it does not bypass sites that block automation. It is intended for owned websites, staging apps, internal tools, and agent-friendly flows where teams want consent-based AI-agent access.

## Install

```bash
npm install -D agentability-audit playwright
npx playwright install chromium
```

## CLI

```bash
npx agentability audit http://localhost:3000 --task page,search --fail-below 80
```

`agentability-audit` is the package name. `agentability` is the primary CLI binary.

For one-off package execution without a local install:

```bash
npx agentability-audit audit http://localhost:3000 --task page,search --fail-below 80
```

Write reports:

```bash
npx agentability audit http://localhost:3000 \
  --task page,search,auth_form,modal,filter,pagination \
  --out reports/agentability.json \
  --html reports/agentability.html \
  --markdown reports/agentability.md \
  --sarif reports/agentability.sarif \
  --junit reports/agentability.junit.xml
```

Explore rules and render reports:

```bash
npx agentability init
npx agentability rules
npx agentability explain actionability/duplicate-button-labels
npx agentability report reports/agentability.json --html reports/agentability.html
```

Use a config file:

```js
// agentability.config.mjs
export default {
  tasks: ["page", "search", "auth_form", "modal", "filter", "pagination"],
  searchQuery: "Richmond ramen",
  observationBackend: "auto",
  failBelow: 80,
  storageState: "playwright/.auth/user.json",
  viewport: { width: 1280, height: 900 },
  output: {
    json: "reports/agentability.json",
    html: "reports/agentability.html",
    sarif: "reports/agentability.sarif",
    junit: "reports/agentability.junit.xml"
  },
  rules: {
    severity: {
      "state_feedback/task-probe-skipped": "info"
    },
    suppress: []
  }
};
```

## Node API

```ts
import { auditUrl } from "agentability-audit";

const report = await auditUrl("http://localhost:3000", {
  tasks: ["page", "search"],
  searchQuery: "Richmond ramen",
  observationBackend: "auto",
  rules: {
    severity: {
      "agent_safety/prompt-injection-like-text": "high"
    }
  }
});

console.log(report.scores.overall);
```

Use an existing Playwright page:

```ts
import { auditPage } from "agentability-audit";
import { test, expect } from "@playwright/test";

test("agentability", async ({ page }) => {
  await page.goto("http://localhost:3000");
  const report = await auditPage(page, { tasks: ["page"] });
  expect(report.scores.overall).toBeGreaterThanOrEqual(80);
});
```

Run multiple targets:

```ts
import { auditProject, defineConfig } from "agentability-audit";

const result = await auditProject(defineConfig({
  targets: [
    { name: "home", url: "http://localhost:3000", tasks: ["page"] },
    { name: "search", url: "http://localhost:3000/search", tasks: ["page", "search"] }
  ]
}));

console.log(result.summary.averageScore);
```

## What The Scores Mean

- `semanticDiscoverability`: agents can find labels, roles, headings, forms, and intent regions.
- `actionability`: executable controls are exposed with unambiguous labels and target identity.
- `stateFeedback`: task probes can observe URL, title, text, dialog, or region changes after actions.
- `recoverability`: exposed elements have stable semantic IDs, locator fingerprints, and lineage.
- `agentSafety`: risky content such as ads or instruction-like page text is structurally distinguishable.

## What This Catches

- Missing input labels, button names, link names, headings, and primary content regions.
- Duplicate action labels and duplicate locator fingerprints.
- Missing action target identity, low-confidence inferred actions, and modal dialogs without dismiss actions.
- Skipped or failed task probes for search, auth/form-like pages, modals, filters, pagination, downloads, and table-like pages.
- Sponsored content that is not structurally separated.
- Prompt-injection-like visible page text that asks agents to ignore instructions.

## What This Does Not Catch Yet

- Full CDP Accessibility tree parity. The current implementation records requested backend and fallback chain, then uses the DOM semantic backend.
- Deep visual layout, canvas semantics, and image-only content.
- Full checkout or destructive-action execution without user-provided safe fixtures.
- Attempts to bypass sites that intentionally block automation.

## Privacy

The package runs locally and does not upload page data. Reports may include visible page text and labels. Use `redact` patterns to remove sensitive values from output:

```ts
await auditUrl("http://localhost:3000", {
  redact: [/customer-\d+/g, "secret-project-name"]
});
```

## Current Scope

The current execution backend is Playwright-controlled Chromium. The current observation implementation is `dom_semantic`: structured state derived from visible DOM, ARIA labels, controls, headings, links, forms, inferred action graph, and intent regions. `auto`, `cdp_ax_tree`, and `playwright_aria` are accepted as requested backends and reported with a fallback chain; CDP Accessibility tree and Playwright ARIA/AI snapshot extraction still need native extraction implementations.
