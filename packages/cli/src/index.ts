#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";

const defaultApiUrl = process.env.ARB_API_URL ?? "http://localhost:8787";

const program = new Command();

program
  .name("arb")
  .description("Agent Runtime Browser CLI")
  .version("0.1.0")
  .option("--api-url <url>", "Runtime API URL", defaultApiUrl);

program
  .command("dev")
  .description("Start the local runtime API and monitor UI")
  .action(() => {
    console.log("Starting Agent Runtime Browser dev services");
    console.log(`Runtime API: ${defaultApiUrl}`);
    console.log("Monitor UI: http://localhost:5173");
    console.log("Submit a task with: arb submit --file ./examples/google-search.json");

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
  .description("Submit a structured task JSON file")
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
  .description("List current runtime tasks")
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
  .description("Show task details")
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
  .description("Show latest structured state for a task")
  .argument("<id>", "Task ID")
  .action(async (id: string) => {
    const response = await apiRequest(`/tasks/${id}/state`);
    console.log(JSON.stringify(response.state, null, 2));
  });

program
  .command("logs")
  .description("Show logs for a task")
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

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function apiRequest(path: string, init?: RequestInit): Promise<any> {
  const options = program.opts<{ apiUrl: string }>();
  const baseUrl = options.apiUrl.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}${path}`, init);
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof body === "object" && body?.error ? `${body.error.code}: ${body.error.message}` : body;
    throw new Error(`Runtime API request failed (${response.status}): ${message}`);
  }

  return body;
}

function shortDate(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  return new Date(value).toLocaleString();
}
