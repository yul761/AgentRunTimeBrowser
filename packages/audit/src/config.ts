import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AuditConfig } from "./index";

const DEFAULT_CONFIG_FILES = [
  "agentability.config.mjs",
  "agentability.config.js",
  "agentability.config.cjs",
  "agentability.config.json"
];

export async function loadAuditConfig(configPath?: string): Promise<AuditConfig> {
  const resolved = configPath ? resolve(process.cwd(), configPath) : findDefaultConfig();
  if (!resolved) {
    return {};
  }

  if (resolved.endsWith(".json")) {
    return JSON.parse(await readFile(resolved, "utf8")) as AuditConfig;
  }

  const module = await import(pathToFileURL(resolved).href) as { default?: AuditConfig; config?: AuditConfig };
  return module.default ?? module.config ?? {};
}

function findDefaultConfig(): string | null {
  for (const file of DEFAULT_CONFIG_FILES) {
    const resolved = resolve(process.cwd(), file);
    if (existsSync(resolved)) {
      return resolved;
    }
  }
  return null;
}
