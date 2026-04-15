#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import {
  auditUrl,
  diffAuditReports,
  getRule,
  listRules,
  validateConfig,
  writeAuditReports,
  type AuditConfig,
  type AuditOptions,
  type AuditReport,
  type AuditReportOutputs,
  type AuditTask,
  type ObservationBackend
} from "./index";
import { loadAuditConfig } from "./config";
import { formatTextReport } from "./reporters";

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
  header?: string[];
  viewport?: string;
  target?: string;
  open?: boolean;
}

const program = new Command();

program
  .name("agentability")
  .description("Audit whether pages are ready for trusted AI-agent use")
  .version("0.1.0");

program
  .command("audit")
  .description("Run an agentability audit for a URL or local HTML file")
  .argument("[url-or-path]", "URL or local HTML file path to audit")
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
  .option("--header <header>", "HTTP header in 'Name: value' form; repeatable", collectOption, [])
  .option("--viewport <size>", "Viewport size as WIDTHxHEIGHT, for example 1280x900")
  .option("--target <name>", "Named target from agentability config")
  .option("--open", "Open the HTML report after generation")
  .action(async (urlOrPath: string | undefined, options: AuditCommandOptions) => {
    const config = await loadAuditConfig(options.config);
    const selectedTarget = selectTarget(config, options.target, urlOrPath);
    const auditOptions = mergeAuditOptions(selectedTarget.config, options);
    const report = await auditUrl(normalizeAuditUrl(selectedTarget.url), auditOptions);

    const written = await writeConfiguredReports(report, selectedTarget.config, options);

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatTextReport(report));
    }

    if (options.open) {
      const htmlPath = written.files.html;
      if (!htmlPath) {
        throw new Error("No HTML report was written. Use --html <path>, --artifact-dir <path>, or config.output.html with --open.");
      }
      openFile(htmlPath);
    }

    const threshold = parseScore(options.failBelow ?? selectedTarget.config.failBelow);
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
    if (rule.examples.length > 0) {
      console.log("");
      console.log("Examples:");
      for (const example of rule.examples) {
        console.log(`- ${example}`);
      }
    }
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
  .option("--artifact-dir <path>", "Directory for rendered artifacts")
  .option("--open", "Open the HTML report after generation")
  .action(async (jsonReport: string, options: Pick<AuditCommandOptions, "html" | "markdown" | "sarif" | "junit" | "artifactDir" | "open">) => {
    const report = JSON.parse(await readFile(resolve(process.cwd(), jsonReport), "utf8")) as AuditReport;
    const written = await writeConfiguredReports(report, { output: {} }, options);
    if (!options.html && !options.markdown && !options.sarif && !options.junit && !options.artifactDir) {
      console.log(formatTextReport(report));
    }
    if (options.open) {
      const htmlPath = written.files.html;
      if (!htmlPath) {
        throw new Error("No HTML report was written. Use --html <path> or --artifact-dir <path> with --open.");
      }
      openFile(htmlPath);
    }
  });

program
  .command("diff")
  .description("Diff two JSON audit reports")
  .argument("<base-json>", "Baseline JSON audit report")
  .argument("<head-json>", "New JSON audit report")
  .option("--json", "Print machine-readable diff JSON")
  .action(async (baseJson: string, headJson: string, options: { json?: boolean }) => {
    const base = JSON.parse(await readFile(resolve(process.cwd(), baseJson), "utf8")) as AuditReport;
    const head = JSON.parse(await readFile(resolve(process.cwd(), headJson), "utf8")) as AuditReport;
    const diff = diffAuditReports(base, head);
    if (options.json) {
      console.log(JSON.stringify(diff, null, 2));
      return;
    }
    console.log(`Agentability report diff`);
    console.log(`Score: ${diff.summary.baseScore} -> ${diff.summary.headScore} (${formatSigned(diff.scoreDelta)})`);
    console.log(`Issues: ${diff.summary.baseIssues} -> ${diff.summary.headIssues} (${formatSigned(diff.issueDelta)})`);
    console.log(`Added issues: ${diff.addedIssues.length}`);
    for (const issue of diff.addedIssues) {
      console.log(`- [${issue.severity}] ${issue.ruleId}: ${issue.title}`);
    }
    console.log(`Removed issues: ${diff.removedIssues.length}`);
    for (const issue of diff.removedIssues) {
      console.log(`- [${issue.severity}] ${issue.ruleId}: ${issue.title}`);
    }
    if (diff.changedSeverities.length > 0) {
      console.log(`Severity changes: ${diff.changedSeverities.length}`);
      for (const change of diff.changedSeverities) {
        console.log(`- ${change.ruleId}: ${change.from} -> ${change.to}`);
      }
    }
  });

program
  .command("validate-config")
  .description("Validate an agentability config file")
  .option("--config <path>", "Path to agentability config file")
  .action(async (options: { config?: string }) => {
    const config = await loadAuditConfig(options.config);
    validateConfig(config);
    console.log("Agentability config is valid.");
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(enhanceRuntimeErrorMessage(message));
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
    storageState: options.storageState ?? config.storageState,
    viewport: options.viewport ? parseViewport(options.viewport) : config.viewport,
    headers: mergeHeaders(config.headers, parseHeaders(options.header ?? []))
  };
}

async function writeConfiguredReports(
  report: Awaited<ReturnType<typeof auditUrl>>,
  config: AuditConfig,
  options: AuditCommandOptions
): Promise<{ files: Record<string, string> }> {
  const jsonPath = options.out ?? config.output?.json;
  const htmlPath = options.html ?? config.output?.html ?? (options.open ? "reports/agentability.html" : undefined);
  const markdownPath = options.markdown ?? config.output?.markdown;
  const sarifPath = options.sarif ?? config.output?.sarif;
  const junitPath = options.junit ?? config.output?.junit;
  const outputs: AuditReportOutputs = {
    json: jsonPath,
    html: htmlPath,
    markdown: markdownPath,
    sarif: sarifPath,
    junit: junitPath,
    artifactDir: options.artifactDir ?? config.artifactDir
  };
  const written = await writeAuditReports(report, outputs);
  for (const path of Object.values(written.files)) {
    console.error(`Saved report: ${path}`);
  }
  return written;
}

function selectTarget(config: AuditConfig, targetName: string | undefined, urlOrPath: string | undefined): { url: string; config: AuditConfig } {
  const target = targetName
    ? (config.targets ?? []).find((candidate) => candidate.name === targetName)
    : undefined;
  if (targetName && !target) {
    throw new Error(`Unknown target "${targetName}" in agentability config.`);
  }

  if (urlOrPath) {
    return {
      url: urlOrPath,
      config: target ? mergeTargetConfig(config, target) : config
    };
  }

  if (target) {
    return {
      url: target.url,
      config: mergeTargetConfig(config, target)
    };
  }

  if ((config.targets ?? []).length === 1 && config.targets?.[0]) {
    return {
      url: config.targets[0].url,
      config: mergeTargetConfig(config, config.targets[0])
    };
  }

  throw new Error("Provide a URL/path argument or use --target with a named target from agentability config.");
}

function mergeTargetConfig(config: AuditConfig, target: NonNullable<AuditConfig["targets"]>[number]): AuditConfig {
  const { name: _name, url: _url, output, failBelow, ...targetOptions } = target;
  return {
    ...config,
    ...targetOptions,
    failBelow: failBelow ?? config.failBelow,
    output: output ?? config.output
  };
}

function normalizeAuditUrl(value: string): string {
  try {
    return new URL(value).href;
  } catch {
    return pathToFileURL(resolve(process.cwd(), value)).href;
  }
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseHeaders(values: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const value of values) {
    const separator = value.indexOf(":");
    if (separator <= 0) {
      throw new Error(`Invalid --header value "${value}". Expected "Name: value".`);
    }
    const name = value.slice(0, separator).trim();
    const headerValue = value.slice(separator + 1).trim();
    if (!name || !headerValue) {
      throw new Error(`Invalid --header value "${value}". Expected "Name: value".`);
    }
    headers[name] = headerValue;
  }
  return headers;
}

function mergeHeaders(
  configHeaders: Record<string, string> | undefined,
  cliHeaders: Record<string, string>
): Record<string, string> | undefined {
  const merged = {
    ...(configHeaders ?? {}),
    ...cliHeaders
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function parseViewport(value: string): { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/i.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid --viewport value "${value}". Expected WIDTHxHEIGHT, for example 1280x900.`);
  }
  return {
    width: parsePositiveInt(match[1], "--viewport width"),
    height: parsePositiveInt(match[2], "--viewport height")
  };
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

function openFile(path: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", path] : [path];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

function formatSigned(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

function enhanceRuntimeErrorMessage(message: string): string {
  if (/Executable doesn't exist|browserType.launch|install/i.test(message) && /chromium|playwright|browser/i.test(message)) {
    return `${message}\n\nPlaywright Chromium is missing. Run: npx playwright install chromium`;
  }
  return message;
}

function defaultConfigTemplate(): string {
  return `// Agentability Audit config
// agentability-audit is the package name; agentability is the CLI binary.
export default {
  tasks: ["page"],
  observationBackend: "auto",
  failBelow: 80,
  viewport: { width: 1280, height: 900 },
  retries: 1,
  headers: {},
  include: [],
  exclude: ["footer", "[aria-hidden='true']", "[data-agentability-ignore]"],
  output: {
    json: "reports/agentability.json",
    html: "reports/agentability.html",
    markdown: "reports/agentability.md",
    sarif: "reports/agentability.sarif",
    junit: "reports/agentability.junit.xml"
  },
  targets: [
    // { name: "home", url: "http://localhost:3000", tasks: ["page"] }
  ],
  rules: {
    severity: {},
    suppress: []
  }
};
`;
}
