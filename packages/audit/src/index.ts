import type { BrowserDriver } from "@arb/browser-driver";
import { PlaywrightBrowserDriver } from "@arb/browser-driver";
import { computeStateDelta } from "@arb/core";
import type { AuditIssue, AuditReport, AuditScores, AuditTaskProbe, StructuredState, Target } from "@arb/schemas";

export interface AuditOptions {
  tasks?: Array<"page" | "search">;
  searchQuery?: string;
  timeoutMs?: number;
}

export type BrowserDriverFactory = () => BrowserDriver;

interface InternalIssueInput {
  severity: AuditIssue["severity"];
  category: AuditIssue["category"];
  title: string;
  message: string;
  evidence?: Record<string, unknown>;
  recommendation?: string;
}

export class AgentabilityAuditor {
  constructor(private readonly driverFactory: BrowserDriverFactory = () => new PlaywrightBrowserDriver()) {}

  async auditUrl(url: string, options: AuditOptions = {}): Promise<AuditReport> {
    const driver = this.driverFactory();
    const tasks = options.tasks?.length ? options.tasks : ["page"];
    const taskProbes: AuditTaskProbe[] = [];

    try {
      await driver.openPage(url, { waitUntil: "domcontentloaded", timeoutMs: options.timeoutMs ?? 30000 });
      const initialState = await driver.getStructuredState();

      for (const task of tasks) {
        if (task === "page") {
          taskProbes.push({
            task,
            status: "passed",
            steps: 1,
            observedEffects: ["structured_state_captured"],
            error: null,
            evidence: {
              actions: initialState.actionGraph.actions.length,
              inputs: initialState.inputs.length,
              links: initialState.links.length
            }
          });
        }

        if (task === "search") {
          taskProbes.push(await runSearchProbe(driver, initialState, options.searchQuery ?? "Richmond ramen"));
        }
      }

      const finalState = await driver.getStructuredState();
      const issues = buildIssues(finalState, taskProbes);

      return {
        reportId: crypto.randomUUID(),
        url,
        finalUrl: finalState.url,
        title: finalState.title,
        generatedAt: new Date().toISOString(),
        scores: scoreReport(finalState, issues, taskProbes),
        issues,
        taskProbes,
        state: finalState
      };
    } finally {
      await driver.close();
    }
  }
}

export async function auditUrl(url: string, options: AuditOptions = {}): Promise<AuditReport> {
  return new AgentabilityAuditor().auditUrl(url, options);
}

async function runSearchProbe(driver: BrowserDriver, beforeState: StructuredState, query: string): Promise<AuditTaskProbe> {
  const input = findSearchInput(beforeState);
  if (!input) {
    return {
      task: "search",
      status: "skipped",
      steps: 0,
      observedEffects: [],
      error: "No search-like input was found in structured state.",
      evidence: {
        inputLabels: beforeState.inputs.map((candidate) => candidate.label)
      }
    };
  }

  try {
    await driver.fill(targetForInput(input), query, 5000);
    await driver.press("Enter", undefined, 5000);
    await driver.waitFor({ kind: "loadState", state: "domcontentloaded" }, 5000).catch(() => undefined);
    const afterState = await driver.getStructuredState();
    const delta = computeStateDelta("audit-search", beforeState, afterState);
    const observedEffects = [
      delta.urlChanged ? "url_changed" : null,
      delta.titleChanged ? "title_changed" : null,
      delta.majorTextChanges.length > 0 ? "visible_text_changed" : null,
      afterState.regions.some((region) => region.kind === "results_list") ? "results_region_detected" : null
    ].filter((value): value is string => Boolean(value));

    return {
      task: "search",
      status: observedEffects.length > 0 ? "passed" : "failed",
      steps: 2,
      observedEffects,
      error: observedEffects.length > 0 ? null : "Search action completed without a detectable structured state change.",
      evidence: {
        inputLabel: input.label,
        beforeStateId: beforeState.stateId,
        afterStateId: afterState.stateId
      }
    };
  } catch (error) {
    return {
      task: "search",
      status: "failed",
      steps: 2,
      observedEffects: [],
      error: error instanceof Error ? error.message : String(error),
      evidence: {
        inputLabel: input.label
      }
    };
  }
}

function buildIssues(state: StructuredState, taskProbes: AuditTaskProbe[]): AuditIssue[] {
  const inputsMissingLabels = state.inputs.filter((input) => /^input \d+$/i.test(input.label) || input.label.trim().length === 0);
  const buttonsMissingNames = state.buttons.filter((button) => /^button \d+$/i.test(button.name) || button.name.trim().length === 0);
  const linksMissingNames = state.links.filter((link) => /^link \d+$/i.test(link.name) || link.name.trim().length === 0);
  const duplicateButtonLabels = duplicateLabels(state.buttons.map((button) => button.name));
  const duplicateLinkLabels = duplicateLabels(state.links.map((link) => link.name));
  const duplicateActionLabels = duplicateLabels(
    state.actionGraph.actions.map((action) => `${action.kind}:${action.label ?? ""}`).filter((value) => !value.endsWith(":"))
  );
  const issues: AuditIssue[] = [];

  if (inputsMissingLabels.length > 0) {
    issues.push(issue("missing-input-labels", {
      severity: "high",
      category: "semantic_discoverability",
      title: "Inputs need stable accessible labels",
      message: `${inputsMissingLabels.length} input(s) do not expose a useful label for agents.`,
      evidence: { labels: inputsMissingLabels.map((input) => input.label) },
      recommendation: "Use visible labels, aria-label, or aria-labelledby so agents can target form fields without CSS fallbacks."
    }));
  }

  if (buttonsMissingNames.length > 0) {
    issues.push(issue("missing-button-names", {
      severity: "high",
      category: "semantic_discoverability",
      title: "Buttons need accessible names",
      message: `${buttonsMissingNames.length} button(s) do not expose a useful accessible name.`,
      evidence: { names: buttonsMissingNames.map((button) => button.name) },
      recommendation: "Give icon-only or generated buttons a visible label or aria-label."
    }));
  }

  if (linksMissingNames.length > 0) {
    issues.push(issue("missing-link-names", {
      severity: "medium",
      category: "semantic_discoverability",
      title: "Links need meaningful names",
      message: `${linksMissingNames.length} link(s) do not expose meaningful text.`,
      evidence: { names: linksMissingNames.map((link) => link.name) },
      recommendation: "Use descriptive link text instead of relying on surrounding visual context."
    }));
  }

  if (duplicateButtonLabels.length > 0) {
    issues.push(issue("duplicate-button-labels", {
      severity: "medium",
      category: "actionability",
      title: "Duplicate button labels make actions ambiguous",
      message: "Multiple buttons expose the same label, which makes agent targeting less reliable.",
      evidence: { duplicates: duplicateButtonLabels },
      recommendation: "Include the object name in repeated controls, for example aria-label=\"View details for Ramen DANBO\"."
    }));
  }

  if (duplicateLinkLabels.length > 0) {
    issues.push(issue("duplicate-link-labels", {
      severity: "low",
      category: "actionability",
      title: "Duplicate link labels reduce action precision",
      message: "Multiple links expose the same label.",
      evidence: { duplicates: duplicateLinkLabels },
      recommendation: "Prefer descriptive link text when repeated links perform different actions."
    }));
  }

  if (duplicateActionLabels.length > 0) {
    issues.push(issue("duplicate-action-labels", {
      severity: "medium",
      category: "actionability",
      title: "Action graph contains ambiguous action labels",
      message: "The action graph has repeated action kind and label pairs.",
      evidence: { duplicates: duplicateActionLabels },
      recommendation: "Make repeated actions distinguishable through names, labels, or stable data attributes."
    }));
  }

  if (state.actionGraph.actions.length === 0) {
    issues.push(issue("empty-action-graph", {
      severity: "high",
      category: "actionability",
      title: "No executable actions were detected",
      message: "The runtime could not infer any executable page actions.",
      recommendation: "Expose controls as semantic buttons, links, inputs, forms, and dialogs."
    }));
  }

  if (!state.regions.some((region) => region.kind === "primary_content")) {
    issues.push(issue("missing-primary-content-region", {
      severity: "medium",
      category: "semantic_discoverability",
      title: "Primary content region was not detected",
      message: "Agents get better context when the main content area is explicit.",
      recommendation: "Use a main element or role=\"main\" around the page's primary task area."
    }));
  }

  if (taskProbes.some((probe) => probe.status === "failed")) {
    issues.push(issue("task-probe-failed", {
      severity: "high",
      category: "state_feedback",
      title: "A task probe failed",
      message: "At least one deterministic agentability probe could not complete or observe a useful state transition.",
      evidence: {
        failed: taskProbes.filter((probe) => probe.status === "failed").map((probe) => ({ task: probe.task, error: probe.error }))
      },
      recommendation: "Expose clear post-action feedback through URL, heading, results list, dialog state, or visible validation messages."
    }));
  }

  if (state.visibleTextSummary.some((line) => /sponsored|advertisement|ad\b/i.test(line)) && !hasExplicitSponsoredRegion(state)) {
    issues.push(issue("sponsored-content-not-regioned", {
      severity: "low",
      category: "agent_safety",
      title: "Sponsored content should be structurally distinguishable",
      message: "The page contains sponsored or advertising text, but no dedicated region exposes that boundary to agents.",
      recommendation: "Mark sponsored areas with explicit labels, regions, or metadata so agents can distinguish organic and paid content."
    }));
  }

  return issues;
}

function scoreReport(state: StructuredState, issues: AuditIssue[], taskProbes: AuditTaskProbe[]): AuditScores {
  const semanticDiscoverability = clampScore(
    95 - penaltyFor(issues, "semantic_discoverability") + Math.min(5, state.headings.length)
  );
  const actionability = clampScore(90 - penaltyFor(issues, "actionability") + Math.min(10, state.actionGraph.actions.length));
  const stateFeedback = clampScore(80 - penaltyFor(issues, "state_feedback") + probeBonus(taskProbes));
  const recoverability = clampScore(80 + identityCoverageScore(state) - duplicateFingerprintPenalty(state));
  const agentSafety = clampScore(90 - penaltyFor(issues, "agent_safety"));
  const overall = clampScore(
    Math.round((semanticDiscoverability + actionability + stateFeedback + recoverability + agentSafety) / 5)
  );

  return {
    overall,
    semanticDiscoverability,
    actionability,
    stateFeedback,
    recoverability,
    agentSafety
  };
}

function findSearchInput(state: StructuredState): StructuredState["inputs"][number] | undefined {
  return state.inputs.find((input) => /search|query|q\b/i.test(`${input.label} ${input.type ?? ""}`));
}

function targetForInput(input: StructuredState["inputs"][number]): Target {
  if (input.label && !/^input \d+$/i.test(input.label)) {
    return { kind: "label", value: input.label, exact: true };
  }
  return { kind: "css", selector: input.locatorFingerprint || "input", internal: true };
}

function issue(id: string, input: InternalIssueInput): AuditIssue {
  return { id, ...input };
}

function duplicateLabels(labels: string[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const label of labels.map((value) => value.trim()).filter(Boolean)) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([label, count]) => ({ label, count }));
}

function hasExplicitSponsoredRegion(state: StructuredState): boolean {
  return state.regions.some((region) => /sponsored|advertis/i.test(region.title ?? ""));
}

function penaltyFor(issues: AuditIssue[], category: AuditIssue["category"]): number {
  return issues
    .filter((issueItem) => issueItem.category === category)
    .reduce((total, issueItem) => total + severityPenalty(issueItem.severity), 0);
}

function severityPenalty(severity: AuditIssue["severity"]): number {
  switch (severity) {
    case "high":
      return 22;
    case "medium":
      return 14;
    case "low":
      return 7;
    case "info":
      return 3;
  }
}

function probeBonus(probes: AuditTaskProbe[]): number {
  const passed = probes.filter((probe) => probe.status === "passed").length;
  const failed = probes.filter((probe) => probe.status === "failed").length;
  return passed * 5 - failed * 15;
}

function identityCoverageScore(state: StructuredState): number {
  const elements = [
    ...state.buttons,
    ...state.inputs,
    ...state.links,
    ...state.headings,
    ...state.forms
  ];
  if (elements.length === 0) {
    return -20;
  }
  const covered = elements.filter((element) => element.semanticElementId && element.locatorFingerprint).length;
  return Math.round((covered / elements.length) * 15);
}

function duplicateFingerprintPenalty(state: StructuredState): number {
  const fingerprints = [
    ...state.buttons,
    ...state.inputs,
    ...state.links,
    ...state.headings,
    ...state.forms
  ].map((element) => element.locatorFingerprint);
  return Math.min(25, duplicateLabels(fingerprints).length * 5);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
