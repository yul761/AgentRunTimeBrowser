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
  --backend auto \
  --viewport 1280x900 \
  --header "X-Agentability: audit" \
  --out reports/agentability.json \
  --html reports/agentability.html \
  --markdown reports/agentability.md \
  --sarif reports/agentability.sarif \
  --junit reports/agentability.junit.xml \
  --open
```

Write a complete artifact set with one flag:

```bash
npx agentability audit http://localhost:3000 --task page,search --artifact-dir reports/agentability
```

Explore rules and render reports:

```bash
npx agentability init
npx agentability rules
npx agentability explain actionability/duplicate-button-labels
npx agentability report reports/agentability.json --html reports/agentability.html
npx agentability diff reports/base.json reports/head.json
npx agentability validate-config
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
  deviceScaleFactor: 1,
  userAgent: "agentability-audit",
  locale: "en-US",
  timezoneId: "America/Vancouver",
  colorScheme: "light",
  reducedMotion: "no-preference",
  include: [],
  exclude: ["footer", "[aria-hidden='true']", "[data-agentability-ignore]"],
  retries: 1,
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

Named targets are supported through config:

```bash
npx agentability audit --target search
```

## Node API

```ts
import { auditUrl, hasBlockingIssues, writeAuditReports } from "agentability-audit";

const report = await auditUrl("http://localhost:3000", {
  tasks: ["page", "search"],
  searchQuery: "Richmond ramen",
  observationBackend: "auto",
  onEvent(event) {
    console.log(event.type, event.task ?? "", event.message ?? "");
  },
  rules: {
    severity: {
      "agent_safety/prompt-injection-like-text": "high"
    }
  }
});

console.log(report.scores.overall);
await writeAuditReports(report, { artifactDir: "reports/agentability" });
process.exitCode = hasBlockingIssues(report, 80) ? 1 : 0;
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

- Full parity with every browser assistant snapshot format. The package now captures CDP Accessibility tree and Playwright ARIA/AI snapshot evidence when available, then falls back to DOM semantic extraction.
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

The current execution backend is Playwright-controlled Chromium. Observation can use `auto`, `cdp_ax_tree`, `playwright_aria`, or `dom_semantic`. Reports record the requested backend, selected backend, fallback chain, and a compact observation evidence summary. Structured state is still normalized into semantic elements, action graph, intent regions, state IDs, and task replay evidence.

## Read Your First Report

- Start with `scores.overall`; use `--fail-below 80` as a CI gate.
- Review `issues` in severity order. Each issue has a stable `ruleId`, category, evidence, and recommendation.
- Check `observations` to confirm whether the run used native CDP Accessibility, Playwright ARIA/AI snapshot, or DOM semantic fallback.
- Check `replay.steps` for task evidence: state IDs before/after, DOM delta summary, network summary, console summary, and duration.
- Use the HTML report for product review and SARIF/JUnit for CI systems.

## CI Examples

GitHub Actions:

```yaml
- run: npx playwright install --with-deps chromium
- run: npm run preview -- --host 127.0.0.1 --port 4173 &
- run: npx wait-on http://127.0.0.1:4173
- run: npx agentability audit http://127.0.0.1:4173 --task page,search --fail-below 80 --artifact-dir reports/agentability
```

Vercel or Netlify preview:

```bash
npx agentability audit "$DEPLOY_PRIME_URL" --task page,form,modal --fail-below 80 --artifact-dir reports/agentability
```

Generic npm script:

```json
{
  "scripts": {
    "agentability": "agentability audit http://localhost:3000 --task page,search --fail-below 80 --artifact-dir reports/agentability"
  }
}
```

## Local Preview Examples

Next.js:

```bash
npm run build
npm run start &
npx agentability audit http://localhost:3000 --task page,form
```

Vite:

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 &
npx agentability audit http://127.0.0.1:4173 --task page,search
```

## Troubleshooting

- Playwright browser missing: run `npx playwright install chromium`.
- Blocked public sites: audit owned, staging, internal, or consent-based agent-friendly apps. This package does not bypass bot protection.
- Authenticated pages: use `storageState`, configured cookies, or an authenticated preview environment.
- Timeouts: increase `--timeout`, check your local preview server, and use `--header` if the preview needs a routing hint.
- Noisy footer/ads/decorative areas: use `exclude` selectors or `data-agentability-ignore`.
- Sensitive reports: configure `redact` patterns and avoid uploading authenticated artifacts publicly.

## Release And Scoring Notes

Reports include `metadata.reportVersion` and `metadata.scoreModelVersion`. Treat rule additions, severity changes, and score weighting changes as changelog-worthy release notes. See `docs/release-checklist.md` in the repository for publish checks.
