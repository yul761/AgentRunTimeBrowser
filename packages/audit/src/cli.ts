#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { auditUrl, getRule, listRules, type AuditConfig, type AuditOptions, type AuditReport, type AuditTask, type ObservationBackend } from "./index";
import { loadAuditConfig } from "./config";
import { formatHtmlReport, formatJunitReport, formatMarkdownReport, formatSarifReport, formatTextReport } from "./reporters";

interface AuditCommandOptions {
  task?: string;
  query?: string;
  timeout?: string;
  out?: string;
  html?: string;
  markdown?: string;
  sarif?: string;
  junit?: string;
  json?: boolean;
  failBelow?: string;
  config?: string;
  backend?: string;
  artifactDir?: string;
  storageState?: string;
}

const program = new Command();

program
  .name("agentability")
  .description("Audit whether pages are ready for trusted AI-agent use")
  .version("0.1.0");

program
  .command("audit")
  .description("Run an agentability audit for a URL or local HTML file")
  .argument("<url-or-path>", "URL or local HTML file path to audit")
  .option("--task <tasks>", "Comma-separated task probes: page,search")
  .option("--query <query>", "Search probe query")
  .option("--timeout <ms>", "Navigation timeout in milliseconds")
  .option("--out <path>", "Write the full JSON audit report to a file")
  .option("--html <path>", "Write an HTML report to a file")
  .option("--markdown <path>", "Write a Markdown report to a file")
  .option("--sarif <path>", "Write a SARIF report to a file")
  .option("--junit <path>", "Write a JUnit XML report to a file")
  .option("--json", "Print the full JSON audit report")
  .option("--fail-below <score>", "Exit non-zero if the overall score is below this value")
  .option("--config <path>", "Path to agentability config file")
  .option("--backend <backend>", "Observation backend: auto, cdp_ax_tree, playwright_aria, dom_semantic")
  .option("--artifact-dir <path>", "Directory for audit artifacts")
  .option("--storage-state <path>", "Playwright storageState path for authenticated audits")
  .action(async (urlOrPath: string, options: AuditCommandOptions) => {
    const config = await loadAuditConfig(options.config);
    const auditOptions = mergeAuditOptions(config, options);
    const report = await auditUrl(normalizeAuditUrl(urlOrPath), auditOptions);

    await writeConfiguredReports(report, config, options);

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatTextReport(report));
    }

    const threshold = parseScore(options.failBelow ?? config.failBelow);
    if (threshold !== undefined && report.scores.overall < threshold) {
      process.exitCode = 1;
    }
  });

program
  .command("init")
  .description("Create an agentability config file")
  .option("--file <path>", "Config file path", "agentability.config.mjs")
  .action(async (options: { file: string }) => {
    const outputPath = resolve(process.cwd(), options.file);
    if (existsSync(outputPath)) {
      throw new Error(`Config file already exists: ${outputPath}`);
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, defaultConfigTemplate(), "utf8");
    console.log(`Created ${outputPath}`);
  });

program
  .command("rules")
  .description("List available audit rules")
  .action(() => {
    console.table(
      listRules().map((rule) => ({
        ruleId: rule.ruleId,
        severity: rule.defaultSeverity,
        category: rule.category,
        title: rule.title
      }))
    );
  });

program
  .command("explain")
  .description("Explain an audit rule")
  .argument("<rule-id>", "Rule ID or short ID")
  .action((ruleId: string) => {
    const rule = getRule(ruleId);
    if (!rule) {
      throw new Error(`Unknown audit rule: ${ruleId}`);
    }
    console.log(`${rule.ruleId}`);
    console.log(`Severity: ${rule.defaultSeverity}`);
    console.log(`Category: ${rule.category}`);
    console.log("");
    console.log(rule.title);
    console.log(rule.rationale);
    console.log("");
    console.log(`Fix: ${rule.recommendation}`);
  });

program
  .command("report")
  .description("Render an existing JSON audit report")
  .argument("<json-report>", "Path to an audit JSON report")
  .option("--html <path>", "Write an HTML report")
  .option("--markdown <path>", "Write a Markdown report")
  .option("--sarif <path>", "Write a SARIF report")
  .option("--junit <path>", "Write a JUnit XML report")
  .action(async (jsonReport: string, options: Pick<AuditCommandOptions, "html" | "markdown" | "sarif" | "junit">) => {
    const report = JSON.parse(await readFile(resolve(process.cwd(), jsonReport), "utf8")) as AuditReport;
    await writeConfiguredReports(report, { output: {} }, options);
    if (!options.html && !options.markdown && !options.sarif && !options.junit) {
      console.log(formatTextReport(report));
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function mergeAuditOptions(config: AuditConfig, options: AuditCommandOptions): AuditOptions {
  return {
    ...config,
    tasks: options.task ? parseAuditTasks(options.task) : config.tasks,
    searchQuery: options.query ?? config.searchQuery,
    timeoutMs: options.timeout ? parsePositiveInt(options.timeout, "--timeout") : config.timeoutMs,
    observationBackend: options.backend ? parseObservationBackend(options.backend) : config.observationBackend,
    artifactDir: options.artifactDir ?? config.artifactDir,
    storageState: options.storageState ?? config.storageState
  };
}

async function writeConfiguredReports(
  report: Awaited<ReturnType<typeof auditUrl>>,
  config: AuditConfig,
  options: AuditCommandOptions
): Promise<void> {
  const jsonPath = options.out ?? config.output?.json;
  const htmlPath = options.html ?? config.output?.html;
  const markdownPath = options.markdown ?? config.output?.markdown;
  const sarifPath = options.sarif ?? config.output?.sarif;
  const junitPath = options.junit ?? config.output?.junit;

  if (jsonPath) {
    await writeReportFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (htmlPath) {
    await writeReportFile(htmlPath, formatHtmlReport(report));
  }
  if (markdownPath) {
    await writeReportFile(markdownPath, formatMarkdownReport(report));
  }
  if (sarifPath) {
    await writeReportFile(sarifPath, formatSarifReport(report));
  }
  if (junitPath) {
    await writeReportFile(junitPath, formatJunitReport(report));
  }
}

async function writeReportFile(path: string, content: string): Promise<void> {
  const outputPath = resolve(process.cwd(), path);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, "utf8");
  console.error(`Saved report: ${outputPath}`);
}

function normalizeAuditUrl(value: string): string {
  try {
    return new URL(value).href;
  } catch {
    return pathToFileURL(resolve(process.cwd(), value)).href;
  }
}

function parseAuditTasks(value: string): AuditTask[] {
  const tasks = value
    .split(",")
    .map((task) => task.trim())
    .filter(Boolean);
  const validTasks = new Set([
    "page",
    "search",
    "auth_form",
    "form",
    "form_validation",
    "modal",
    "menu",
    "filter",
    "pagination",
    "download",
    "table"
  ]);
  const invalid = tasks.filter((task) => !validTasks.has(task));
  if (invalid.length > 0) {
    throw new Error(`Unsupported audit task probe: ${invalid.join(", ")}`);
  }
  return tasks as AuditTask[];
}

function parseObservationBackend(value: string): ObservationBackend {
  if (value === "auto" || value === "cdp_ax_tree" || value === "playwright_aria" || value === "dom_semantic") {
    return value;
  }
  throw new Error(`Unsupported observation backend: ${value}`);
}

function parseScore(value: string | number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`Invalid --fail-below value: ${value}`);
    }
    return value;
  }
  const score = Number.parseInt(value, 10);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error(`Invalid --fail-below value: ${value}`);
  }
  return score;
}

function parsePositiveInt(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label} value: ${value}`);
  }
  return parsed;
}

function defaultConfigTemplate(): string {
  return `// Agentability Audit config
// agentability-audit is the package name; agentability is the CLI binary.
export default {
  tasks: ["page"],
  observationBackend: "auto",
  failBelow: 80,
  output: {
    json: "reports/agentability.json",
    html: "reports/agentability.html",
    sarif: "reports/agentability.sarif",
    junit: "reports/agentability.junit.xml"
  },
  rules: {
    severity: {},
    suppress: []
  }
};
`;
}
