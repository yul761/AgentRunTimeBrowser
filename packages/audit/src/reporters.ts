import type { AuditIssue, AuditReport, AuditSeverity } from "./index";

export function formatTextReport(report: AuditReport): string {
  const lines = [
    `Agentability audit for ${report.finalUrl}`,
    `Title: ${report.title || "not available"}`,
    `Overall score: ${report.scores.overall}/100`,
    "",
    "Scores:",
    `- semantic: ${report.scores.semanticDiscoverability}`,
    `- actionability: ${report.scores.actionability}`,
    `- feedback: ${report.scores.stateFeedback}`,
    `- recoverability: ${report.scores.recoverability}`,
    `- safety: ${report.scores.agentSafety}`,
    "",
    "Task probes:",
    ...formatProbeLines(report),
    "",
    "Issues:",
    ...formatIssueLines(report.issues)
  ];

  return `${lines.join("\n")}\n`;
}

export function formatMarkdownReport(report: AuditReport): string {
  const issueRows = [...report.issues].sort(compareIssues).map((issue) => {
    const fix = issue.recommendation ? escapeMarkdownTable(issue.recommendation) : "";
    return `| ${issue.severity} | ${issue.category} | ${escapeMarkdownTable(issue.title)} | ${fix} |`;
  });
  const probeRows = report.taskProbes.map(
    (probe) =>
      `| ${probe.task} | ${probe.status} | ${probe.steps} | ${escapeMarkdownTable(probe.observedEffects.join(", ") || probe.error || "")} |`
  );

  return [
    `# Agentability Audit: ${report.title || report.finalUrl}`,
    "",
    `**URL:** ${report.finalUrl}`,
    `**Overall score:** ${report.scores.overall}/100`,
    "",
    "## Scores",
    "",
    "| Dimension | Score |",
    "| --- | ---: |",
    `| Semantic discoverability | ${report.scores.semanticDiscoverability} |`,
    `| Actionability | ${report.scores.actionability} |`,
    `| State feedback | ${report.scores.stateFeedback} |`,
    `| Recoverability | ${report.scores.recoverability} |`,
    `| Agent safety | ${report.scores.agentSafety} |`,
    "",
    "## Task Probes",
    "",
    "| Task | Status | Steps | Evidence |",
    "| --- | --- | ---: | --- |",
    ...(probeRows.length > 0 ? probeRows : ["| none | skipped | 0 | |"]),
    "",
    "## Issues",
    "",
    "| Severity | Category | Issue | Fix |",
    "| --- | --- | --- | --- |",
    ...(issueRows.length > 0 ? issueRows : ["| info | none | No issues detected | |"]),
    ""
  ].join("\n");
}

export function formatHtmlReport(report: AuditReport): string {
  const issues = [...report.issues].sort(compareIssues);
  const issueItems = issues
    .map(
      (issue) => `<li class="issue ${issue.severity}">
        <strong>${escapeHtml(issue.title)}</strong>
        <span>${escapeHtml(issue.severity)} / ${escapeHtml(issue.category)}</span>
        <p>${escapeHtml(issue.message)}</p>
        ${issue.recommendation ? `<p><b>Fix:</b> ${escapeHtml(issue.recommendation)}</p>` : ""}
      </li>`
    )
    .join("\n");
  const probes = report.taskProbes
    .map(
      (probe) => `<li>
        <strong>${escapeHtml(probe.task)}</strong>: ${escapeHtml(probe.status)}
        <span>${escapeHtml(probe.observedEffects.join(", ") || probe.error || "")}</span>
      </li>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Agentability Audit Report</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 32px; color: #20242a; line-height: 1.45; }
      main { max-width: 980px; margin: 0 auto; }
      .score { font-size: 48px; font-weight: 700; margin: 12px 0; }
      .scores { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; padding: 0; }
      .scores li, .issue, .probe { border: 1px solid #d8dee4; border-radius: 8px; padding: 12px; list-style: none; }
      .issue span { display: block; color: #5f6b76; margin: 4px 0; }
      .high { border-left: 6px solid #b42318; }
      .medium { border-left: 6px solid #b54708; }
      .low { border-left: 6px solid #175cd3; }
      .info { border-left: 6px solid #5f6b76; }
      code { word-break: break-all; }
    </style>
  </head>
  <body>
    <main>
      <h1>Agentability Audit Report</h1>
      <p><code>${escapeHtml(report.finalUrl)}</code></p>
      <div class="score">${report.scores.overall}/100</div>
      <h2>Scores</h2>
      <ul class="scores">
        <li>Semantic discoverability<br /><strong>${report.scores.semanticDiscoverability}</strong></li>
        <li>Actionability<br /><strong>${report.scores.actionability}</strong></li>
        <li>State feedback<br /><strong>${report.scores.stateFeedback}</strong></li>
        <li>Recoverability<br /><strong>${report.scores.recoverability}</strong></li>
        <li>Agent safety<br /><strong>${report.scores.agentSafety}</strong></li>
      </ul>
      <h2>Task Probes</h2>
      <ul class="probe">${probes || "<li>No probes ran.</li>"}</ul>
      <h2>Issues</h2>
      <ul>${issueItems || "<li>No issues detected.</li>"}</ul>
    </main>
  </body>
</html>
`;
}

export function formatSarifReport(report: AuditReport): string {
  const rulesById = new Map(report.issues.map((issue) => [issue.ruleId, issue]));
  return `${JSON.stringify(
    {
      version: "2.1.0",
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      runs: [
        {
          tool: {
            driver: {
              name: "agentability-audit",
              informationUri: "https://github.com/yul761/AgentRunTimeBrowser",
              rules: [...rulesById.values()].map((issue) => ({
                id: issue.ruleId,
                name: issue.title,
                shortDescription: { text: issue.title },
                fullDescription: { text: issue.message },
                help: { text: issue.recommendation ?? issue.message, markdown: issue.recommendation ?? issue.message },
                defaultConfiguration: { level: sarifLevel(issue.severity) }
              }))
            }
          },
          results: report.issues.map((issue) => ({
            ruleId: issue.ruleId,
            level: sarifLevel(issue.severity),
            message: { text: `${issue.title}: ${issue.message}` },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: report.finalUrl }
                }
              }
            ],
            properties: {
              category: issue.category,
              recommendation: issue.recommendation,
              evidence: issue.evidence
            }
          }))
        }
      ]
    },
    null,
    2
  )}\n`;
}

export function formatJunitReport(report: AuditReport): string {
  const highIssues = report.issues.filter((issue) => issue.severity === "high");
  const testcase = report.issues.length
    ? report.issues
        .map((issue) => {
          const body = issue.severity === "high"
            ? `<failure message="${escapeXml(issue.title)}">${escapeXml(issue.message)}</failure>`
            : `<system-out>${escapeXml(issue.message)}</system-out>`;
          return `    <testcase classname="agentability.${escapeXml(issue.category)}" name="${escapeXml(issue.ruleId)}">\n      ${body}\n    </testcase>`;
        })
        .join("\n")
    : `    <testcase classname="agentability" name="no-issues" />`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="agentability-audit" tests="${Math.max(1, report.issues.length)}" failures="${highIssues.length}" errors="0">
${testcase}
</testsuite>
`;
}

function formatProbeLines(report: AuditReport): string[] {
  if (report.taskProbes.length === 0) {
    return ["- none"];
  }
  return report.taskProbes.map((probe) => {
    const effects = probe.observedEffects.length > 0 ? ` effects=${probe.observedEffects.join(",")}` : "";
    const error = probe.error ? ` error=${probe.error}` : "";
    return `- ${probe.task}: ${probe.status} steps=${probe.steps}${effects}${error}`;
  });
}

function formatIssueLines(issues: AuditIssue[]): string[] {
  if (issues.length === 0) {
    return ["- none"];
  }
  return [...issues].sort(compareIssues).flatMap((issue) => [
    `- [${issue.severity}] ${issue.category}: ${issue.title}`,
    `  ${issue.message}`,
    ...(issue.recommendation ? [`  Fix: ${issue.recommendation}`] : [])
  ]);
}

function compareIssues(left: AuditIssue, right: AuditIssue): number {
  return severityRank(right.severity) - severityRank(left.severity);
}

function severityRank(severity: AuditSeverity): number {
  switch (severity) {
    case "high":
      return 4;
    case "medium":
      return 3;
    case "low":
      return 2;
    case "info":
      return 1;
  }
}

function sarifLevel(severity: AuditSeverity): "error" | "warning" | "note" {
  switch (severity) {
    case "high":
      return "error";
    case "medium":
    case "low":
      return "warning";
    case "info":
      return "note";
  }
}

function escapeMarkdownTable(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeXml(value: string): string {
  return escapeHtml(value).replace(/'/g, "&apos;");
}
