#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { auditUrl, type AuditIssue, type AuditOptions, type AuditReport, type AuditTaskProbe } from "agentability-audit";
import { Command } from "commander";

const defaultApiUrl = process.env.ARB_API_URL ?? "http://localhost:8787";

const program = new Command();

program
  .name("arb")
  .description("Agentability Audit CLI")
  .version("0.1.0")
  .option("--api-url <url>", "Optional runtime inspection API URL", defaultApiUrl);

program
  .command("dev")
  .description("Start optional local runtime inspection services")
  .action(() => {
    console.log("Starting Agentability Audit runtime inspection services");
    console.log(`Runtime inspection API: ${defaultApiUrl}`);
    console.log("Probe monitor UI: http://localhost:5173");
    console.log("Run an audit with: arb audit ./baseline/search-fixture.html --task page,search");

    const children: ChildProcess[] = [
      spawn("pnpm", ["--filter", "@arb/runtime-api", "dev"], {
        stdio: "inherit",
        shell: process.platform === "win32"
      }),
      spawn("pnpm", ["--filter", "@arb/monitor-ui", "dev", "--", "--host", "127.0.0.1"], {
        stdio: "inherit",
        shell: process.platform === "win32"
      })
    ];

    const shutdown = () => {
      for (const child of children) {
        child.kill("SIGINT");
      }
    };

    process.on("SIGINT", () => {
      shutdown();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      shutdown();
      process.exit(0);
    });
  });

program
  .command("submit")
  .description("Submit a lower-level structured runtime task JSON file")
  .requiredOption("--file <path>", "Path to task JSON file")
  .action(async (options: { file: string }) => {
    const filePath = resolve(process.cwd(), options.file);
    const raw = await readFile(filePath, "utf8");
    const task = JSON.parse(raw) as unknown;
    const result = await apiRequest("/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(task)
    });
    console.log(`Submitted ${result.taskType} task`);
    console.log(`Task ID: ${result.taskId}`);
    console.log(`Status: ${result.status}`);
    console.log(`Inspect: arb task ${result.taskId}`);
  });

program
  .command("tasks")
  .description("List current runtime probe tasks")
  .action(async () => {
    const tasks = await apiRequest("/tasks");
    if (!Array.isArray(tasks) || tasks.length === 0) {
      console.log("No tasks found.");
      return;
    }
    console.table(
      tasks.map((task) => ({
        id: task.taskId,
        type: task.taskType,
        status: task.status,
        step: `${task.completedSteps}/${task.totalSteps}`,
        current: task.currentStepLabel ?? "",
        started: shortDate(task.startedAt)
      }))
    );
  });

program
  .command("task")
  .description("Show runtime probe task details")
  .argument("<id>", "Task ID")
  .action(async (id: string) => {
    const task = await apiRequest(`/tasks/${id}`);
    console.log(`${task.taskType} ${task.taskId}`);
    console.log(`Status: ${task.status}`);
    console.log(`Progress: ${task.completedSteps}/${task.totalSteps}`);
    console.log(`Current step: ${task.currentStepLabel ?? "none"}`);
    console.log(`URL: ${task.finalUrl ?? "not available"}`);
    console.log(`Title: ${task.finalTitle ?? "not available"}`);
    if (task.error) {
      console.log(`Error: ${task.error.code} - ${task.error.message}`);
    }
    if (task.extractedData && Object.keys(task.extractedData).length > 0) {
      console.log("Extracted data:");
      console.log(JSON.stringify(task.extractedData, null, 2));
    }
  });

program
  .command("state")
  .description("Show latest structured browser state for a runtime task")
  .argument("<id>", "Task ID")
  .action(async (id: string) => {
    const response = await apiRequest(`/tasks/${id}/state`);
    console.log(JSON.stringify(response.state, null, 2));
  });

program
  .command("logs")
  .description("Show logs for a runtime task")
  .argument("<id>", "Task ID")
  .action(async (id: string) => {
    const response = await apiRequest(`/tasks/${id}/logs`);
    for (const log of response.logs ?? []) {
      const step = log.stepIndex === null ? "" : ` step=${log.stepIndex + 1}`;
      console.log(`[${log.timestamp}] ${log.level.toUpperCase()}${step} ${log.message}`);
      if (log.data) {
        console.log(JSON.stringify(log.data, null, 2));
      }
    }
  });

program
  .command("audit")
  .description("Audit whether a page is ready for structured AI agent use")
  .argument("<url-or-path>", "URL or local HTML file path to audit")
  .option("--task <tasks>", "Comma-separated task probes: page,search", "page")
  .option("--query <query>", "Search probe query", "Richmond ramen")
  .option("--out <path>", "Write the full JSON audit report to a file")
  .option("--json", "Print the full JSON audit report")
  .option("--fail-below <score>", "Exit non-zero if the overall score is below this value")
  .action(async (urlOrPath: string, options: AuditCommandOptions) => {
    const report = await auditUrl(normalizeAuditUrl(urlOrPath), {
      tasks: parseAuditTasks(options.task),
      searchQuery: options.query
    });

    if (options.out) {
      const outputPath = resolve(process.cwd(), options.out);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      console.log(`Saved audit report: ${outputPath}`);
    }

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printAuditReport(report);
    }

    if (options.failBelow !== undefined) {
      const threshold = Number.parseInt(options.failBelow, 10);
      if (Number.isNaN(threshold)) {
        throw new Error(`Invalid --fail-below score: ${options.failBelow}`);
      }
      if (report.scores.overall < threshold) {
        process.exitCode = 1;
      }
    }
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

interface AuditCommandOptions {
  task: string;
  query: string;
  out?: string;
  json?: boolean;
  failBelow?: string;
}

async function apiRequest(path: string, init?: RequestInit): Promise<any> {
  const options = program.opts<{ apiUrl: string }>();
  const baseUrl = options.apiUrl.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}${path}`, init);
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof body === "object" && body?.error ? `${body.error.code}: ${body.error.message}` : body;
    throw new Error(`Probe inspection API request failed (${response.status}): ${message}`);
  }

  return body;
}

function shortDate(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  return new Date(value).toLocaleString();
}

function normalizeAuditUrl(value: string): string {
  try {
    return new URL(value).href;
  } catch {
    return pathToFileURL(resolve(process.cwd(), value)).href;
  }
}

function parseAuditTasks(value: string): NonNullable<AuditOptions["tasks"]> {
  const tasks = value
    .split(",")
    .map((task) => task.trim())
    .filter(Boolean);
  const invalid = tasks.filter((task) => task !== "page" && task !== "search");
  if (invalid.length > 0) {
    throw new Error(`Unsupported audit task probe: ${invalid.join(", ")}`);
  }
  return tasks as NonNullable<AuditOptions["tasks"]>;
}

function printAuditReport(report: AuditReport): void {
  console.log(`Agentability audit for ${report.finalUrl}`);
  console.log(`Title: ${report.title || "not available"}`);
  console.log(`Overall score: ${report.scores.overall}/100`);
  console.table({
    semantic: report.scores.semanticDiscoverability,
    actionability: report.scores.actionability,
    feedback: report.scores.stateFeedback,
    recoverability: report.scores.recoverability,
    safety: report.scores.agentSafety
  });

  printTaskProbes(report.taskProbes);
  printIssues(report.issues);
}

function printTaskProbes(probes: AuditTaskProbe[]): void {
  console.log("");
  console.log("Task probes:");
  if (probes.length === 0) {
    console.log("- none");
    return;
  }
  for (const probe of probes) {
    const effects = probe.observedEffects.length > 0 ? ` effects=${probe.observedEffects.join(",")}` : "";
    const error = probe.error ? ` error=${probe.error}` : "";
    console.log(`- ${probe.task}: ${probe.status} steps=${probe.steps}${effects}${error}`);
  }
}

function printIssues(issues: AuditIssue[]): void {
  console.log("");
  console.log("Issues:");
  if (issues.length === 0) {
    console.log("- none");
    return;
  }

  for (const issue of [...issues].sort(compareIssues)) {
    console.log(`- [${issue.severity}] ${issue.category}: ${issue.title}`);
    console.log(`  ${issue.message}`);
    if (issue.recommendation) {
      console.log(`  Fix: ${issue.recommendation}`);
    }
  }
}

function compareIssues(left: AuditIssue, right: AuditIssue): number {
  return severityRank(right.severity) - severityRank(left.severity);
}

function severityRank(severity: AuditIssue["severity"]): number {
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
