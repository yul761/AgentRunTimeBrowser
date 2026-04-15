// Example Agentability Audit config.
// Install with:
//   npm install -D agentability-audit playwright
//   npx playwright install chromium
// Run with:
//   npx agentability audit --target local

export default {
  failBelow: 80,
  observationBackend: "auto",
  retries: 1,
  viewport: { width: 1280, height: 900 },
  exclude: ["footer", "[aria-hidden='true']", "[data-agentability-ignore]"],
  output: {
    json: "reports/agentability.json",
    html: "reports/agentability.html",
    markdown: "reports/agentability.md",
    sarif: "reports/agentability.sarif",
    junit: "reports/agentability.junit.xml"
  },
  targets: [
    {
      name: "local",
      url: "http://localhost:3000",
      tasks: ["page", "search"],
      searchQuery: "Richmond ramen"
    },
    {
      name: "auth",
      url: "http://localhost:3000/login",
      tasks: ["page", "auth_form", "form_validation"],
      storageState: "playwright/.auth/user.json"
    },
    {
      name: "table",
      url: "http://localhost:3000/admin/orders",
      tasks: ["page", "table", "filter", "pagination"]
    }
  ],
  rules: {
    severity: {
      "state_feedback/task-probe-skipped": "info"
    },
    suppress: [
      // { ruleId: "actionability/duplicate-link-labels", reason: "Known fixture-only duplicate links." }
    ]
  },
  redact: [/customer-\d+/g, /token=[^&\s]+/g]
};
