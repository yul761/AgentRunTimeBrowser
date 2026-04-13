import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { runBaselineAgent } from "./baseline-agent";

async function main(): Promise<void> {
  loadLocalEnv();
  const result = await runBaselineAgent();
  const outputPath = resolve(process.cwd(), "benchmark-results", "baseline.json");

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log("=== BASELINE RESULT ===");
  console.log(`Target: ${result.target}`);
  console.log(`Live Google Status: ${result.liveGoogleStatus}`);
  console.log(`Fallback Used: ${result.fallbackUsed ? "yes" : "no"}`);
  if (result.blockReason) {
    console.log(`Block Reason: ${result.blockReason}`);
  }
  console.log(`Total Tokens: ${result.totalTokens}`);
  console.log(`Total Latency: ${result.totalLatencyMs} ms`);
  console.log("");
  console.log("Top Results:");
  result.extractedResults.forEach((title, index) => {
    console.log(`${index + 1}. ${title}`);
  });
  console.log("");
  console.log(`Saved: ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function loadLocalEnv(): void {
  try {
    loadEnvFile(resolve(process.cwd(), ".env"));
  } catch {
    // .env is optional; explicit environment variables still work.
  }
}
