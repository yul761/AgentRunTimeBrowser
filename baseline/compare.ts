import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { InMemoryTaskStore, type TaskRecord } from "@arb/core";
import type { TaskSubmission } from "@arb/schemas";
import { TaskEngine } from "@arb/task-engine";
import { runBaselineAgent } from "./baseline-agent";
import type { BenchmarkTarget } from "./types";

type RuntimeMode = "observed" | "lean";
type RunnerName = "baseline_agent" | "runtime_observed" | "runtime_lean";

interface ComparisonRow {
  scenario: BenchmarkTarget;
  runner: RunnerName;
  status: string;
  totalTokens: number;
  totalLatencyMs: number;
  extractedResults: string[];
  resultCount: number;
  finalUrl?: string | null;
  note?: string;
}

const ALL_TARGETS: BenchmarkTarget[] = ["fixture", "complex_fixture", "live_web", "google"];
const FIXTURE_EXPECTED = [
  "Ramen DANBO Richmond",
  "G-Men Ramen Richmond",
  "AFURI Ramen Richmond Centre",
  "Kintaro Ramen near Richmond",
  "Marutama Ramen Richmond options"
];
const LIVE_EXPECTED = ["Maruchan", "Tsukemen", "Ramen Street", "Ann Beretta", "Toyo Suisan"];
const LIVE_WEB_URL = "https://en.wikipedia.org/w/index.php?search=Richmond%20ramen&title=Special%3ASearch&fulltext=1&ns0=1";

async function main(): Promise<void> {
  loadLocalEnv();

  const targets = parseTargets(process.env.COMPARE_TARGETS);
  const fixtureServer = await startFixtureServer();
  const rows: ComparisonRow[] = [];

  try {
    for (const scenario of targets) {
      rows.push(await runBaselineScenario(scenario));
      rows.push(await runRuntimeScenario(scenario, "observed", fixtureServer.fixtureUrl));
      rows.push(await runRuntimeScenario(scenario, "lean", fixtureServer.fixtureUrl));
    }
  } finally {
    await fixtureServer.close();
  }

  const outputPath = resolve(process.cwd(), "benchmark-results", "comparison.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2)}\n`, "utf8");

  printRows(rows, outputPath);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function runBaselineScenario(scenario: BenchmarkTarget): Promise<ComparisonRow> {
  const previousTarget = process.env.BASELINE_TARGET;
  process.env.BASELINE_TARGET = scenario;

  const startedAt = Date.now();
  try {
    const result = await runBaselineAgent();
    return {
      scenario,
      runner: "baseline_agent",
      status: result.liveGoogleStatus === "blocked" ? "blocked_with_fixture_fallback" : "success",
      totalTokens: result.totalTokens,
      totalLatencyMs: result.totalLatencyMs || Date.now() - startedAt,
      extractedResults: result.extractedResults,
      resultCount: result.extractedResults.length,
      note: result.blockReason
    };
  } finally {
    if (previousTarget === undefined) {
      delete process.env.BASELINE_TARGET;
    } else {
      process.env.BASELINE_TARGET = previousTarget;
    }
  }
}

async function runRuntimeScenario(
  scenario: BenchmarkTarget,
  mode: RuntimeMode,
  fixtureUrl: string
): Promise<ComparisonRow> {
  const store = new InMemoryTaskStore();
  const engine = new TaskEngine(store);
  const submission = runtimeSubmissionFor(scenario, mode, fixtureUrl);
  const startedAt = Date.now();
  const record = await engine.submitTask(submission, { async: false });
  const totalLatencyMs = Date.now() - startedAt;
  const googleBlocked = isGoogleBlockedUrl(record.finalUrl ?? "");
  const extractedResults = googleBlocked ? [] : extractRuntimeResults(record, scenario);

  return {
    scenario,
    runner: mode === "observed" ? "runtime_observed" : "runtime_lean",
    status: googleBlocked ? "blocked" : record.status,
    totalTokens: 0,
    totalLatencyMs,
    extractedResults,
    resultCount: extractedResults.length,
    finalUrl: record.finalUrl,
    note: record.error?.message ?? (googleBlocked ? "Google returned the /sorry anti-automation page." : undefined)
  };
}

function runtimeSubmissionFor(scenario: BenchmarkTarget, mode: RuntimeMode, fixtureUrl: string): TaskSubmission {
  const runtime = {
    capturePreview: mode === "observed",
    captureEvidence: mode === "observed",
    observationProfile: mode === "lean" ? "interactive_only" : "full"
  } as const;

  if (scenario === "google") {
    return {
      taskType: "web.search",
      runtime,
      input: {
        engine: "google",
        query: "Richmond ramen"
      }
    };
  }

  if (scenario === "live_web") {
    return {
      taskType: "workflow.execute",
      runtime,
      input: {
        steps: [
          { action: "navigate", url: LIVE_WEB_URL, waitUntil: "domcontentloaded", timeoutMs: 30000 },
          { action: "extract", extract: { kind: "links", name: "searchResults" } }
        ]
      }
    };
  }

  if (scenario === "complex_fixture") {
    return {
      taskType: "workflow.execute",
      runtime,
      input: {
        steps: [
          { action: "navigate", url: fixtureUrl, waitUntil: "domcontentloaded" },
          { action: "fill", target: { kind: "label", value: "Search", exact: true }, value: "Richmond ramen" },
          { action: "click", target: { kind: "label", value: "Open now", exact: true } },
          { action: "click", target: { kind: "role", role: "button", name: "Sort by rating", exact: true } },
          { action: "click", target: { kind: "role", role: "button", name: "Apply filters", exact: true } },
          { action: "waitFor", condition: { kind: "text", value: "Open now filtered results" }, timeoutMs: 5000 },
          { action: "extract", extract: { kind: "links", name: "searchResults" } }
        ]
      }
    };
  }

  return {
    taskType: "workflow.execute",
    runtime,
    input: {
      steps: [
        { action: "navigate", url: fixtureUrl, waitUntil: "domcontentloaded" },
        { action: "extract", extract: { kind: "links", name: "searchResults" } }
      ]
    }
  };
}

function extractRuntimeResults(record: TaskRecord, scenario: BenchmarkTarget): string[] {
  const rawLinks = record.extractedData.searchResults;
  if (!Array.isArray(rawLinks)) {
    return [];
  }

  const names = rawLinks
    .map((value) => {
      if (!isObject(value)) {
        return "";
      }
      return typeof value.name === "string" ? value.name.trim() : "";
    })
    .filter(Boolean);

  const expected = expectedResultsFor(scenario);
  if (expected.length === 0) {
    return names.slice(0, 5);
  }

  const expectedSet = new Set(expected);
  const results: string[] = [];
  for (const name of names) {
    if (expectedSet.has(name) && !results.includes(name)) {
      results.push(name);
    }
  }
  return results.slice(0, 5);
}

function expectedResultsFor(scenario: BenchmarkTarget): string[] {
  if (scenario === "fixture" || scenario === "complex_fixture") {
    return FIXTURE_EXPECTED;
  }
  if (scenario === "live_web") {
    return LIVE_EXPECTED;
  }
  return [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGoogleBlockedUrl(url: string): boolean {
  return url.includes("google.com/sorry") || url.includes("/sorry/index");
}

function parseTargets(input: string | undefined): BenchmarkTarget[] {
  if (!input) {
    return ALL_TARGETS;
  }

  const targets = input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const invalid = targets.filter((value) => !isBenchmarkTarget(value));
  if (invalid.length > 0) {
    throw new Error(`Invalid COMPARE_TARGETS value: ${invalid.join(", ")}`);
  }

  return targets as BenchmarkTarget[];
}

function isBenchmarkTarget(value: string): value is BenchmarkTarget {
  return ALL_TARGETS.includes(value as BenchmarkTarget);
}

async function startFixtureServer(): Promise<{ fixtureUrl: string; close: () => Promise<void> }> {
  const fixturePath = resolve(process.cwd(), "baseline", "search-fixture.html");
  const fixtureHtml = await readFile(fixturePath, "utf8");
  const server: Server = createServer((req, res) => {
    if (req.url === "/" || req.url === "/search-fixture.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(fixtureHtml);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  });

  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not bind benchmark fixture server.");
  }

  return {
    fixtureUrl: `http://127.0.0.1:${(address as AddressInfo).port}/search-fixture.html`,
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose()))
  };
}

function printRows(rows: ComparisonRow[], outputPath: string): void {
  console.log("=== COMPARISON RESULT ===");
  console.table(
    rows.map((row) => ({
      scenario: row.scenario,
      runner: row.runner,
      status: row.status,
      tokens: row.totalTokens,
      latencyMs: row.totalLatencyMs,
      results: row.resultCount
    }))
  );

  const notes = rows.filter((row) => row.note);
  if (notes.length > 0) {
    console.log("");
    console.log("Notes:");
    for (const row of notes) {
      console.log(`- ${row.scenario} / ${row.runner}: ${row.note}`);
    }
  }

  console.log("");
  console.log(`Saved: ${outputPath}`);
}

function loadLocalEnv(): void {
  try {
    loadEnvFile(resolve(process.cwd(), ".env"));
  } catch {
    // .env is optional; explicit environment variables still work.
  }
}
