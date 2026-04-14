#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { auditUrl, type AuditConfig, type AuditOptions, type AuditTask } from "./index";
import { loadAuditConfig } from "./config";
import { formatHtmlReport, formatMarkdownReport, formatTextReport } from "./reporters";

interface AuditCommandOptions {
  task?: string;
  query?: string;
  timeout?: string;
  out?: string;
  html?: string;
  markdown?: string;
  json?: boolean;
  failBelow?: string;
  config?: string;
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
  .option("--json", "Print the full JSON audit report")
  .option("--fail-below <score>", "Exit non-zero if the overall score is below this value")
  .option("--config <path>", "Path to agentability config file")
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

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function mergeAuditOptions(config: AuditConfig, options: AuditCommandOptions): AuditOptions {
  return {
    ...config,
    tasks: options.task ? parseAuditTasks(options.task) : config.tasks,
    searchQuery: options.query ?? config.searchQuery,
    timeoutMs: options.timeout ? parsePositiveInt(options.timeout, "--timeout") : config.timeoutMs
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

  if (jsonPath) {
    await writeReportFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (htmlPath) {
    await writeReportFile(htmlPath, formatHtmlReport(report));
  }
  if (markdownPath) {
    await writeReportFile(markdownPath, formatMarkdownReport(report));
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
  const invalid = tasks.filter((task) => task !== "page" && task !== "search");
  if (invalid.length > 0) {
    throw new Error(`Unsupported audit task probe: ${invalid.join(", ")}`);
  }
  return tasks as AuditTask[];
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
