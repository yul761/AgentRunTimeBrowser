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

For one-off package execution without a local install:

```bash
npx agentability-audit audit http://localhost:3000 --task page,search --fail-below 80
```

Write reports:

```bash
npx agentability audit http://localhost:3000 \
  --task page,search \
  --out reports/agentability.json \
  --html reports/agentability.html \
  --markdown reports/agentability.md
```

Use a config file:

```js
// agentability.config.mjs
export default {
  tasks: ["page", "search"],
  searchQuery: "Richmond ramen",
  failBelow: 80,
  output: {
    json: "reports/agentability.json",
    html: "reports/agentability.html"
  }
};
```

## Node API

```ts
import { auditUrl } from "agentability-audit";

const report = await auditUrl("http://localhost:3000", {
  tasks: ["page", "search"],
  searchQuery: "Richmond ramen"
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

## Privacy

The package runs locally and does not upload page data. Reports may include visible page text and labels. Use `redact` patterns to remove sensitive values from output:

```ts
await auditUrl("http://localhost:3000", {
  redact: [/customer-\d+/g, "secret-project-name"]
});
```

## Current Scope

The current observation backend is `dom_semantic`: structured state derived from visible DOM, ARIA labels, controls, headings, links, forms, inferred action graph, and intent regions. CDP Accessibility tree and Playwright ARIA/AI snapshot backends are planned.
