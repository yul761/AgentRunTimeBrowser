import { PlaywrightBrowserDriver, buildStructuredStateFromDocument } from "@arb/browser-driver";
import { computeStateDelta } from "@arb/core";
import { chromium, type Page } from "playwright";

export { loadAuditConfig } from "./config";
export { formatHtmlReport, formatMarkdownReport, formatTextReport } from "./reporters";

export type AuditTask = "page" | "search";
export type AuditSeverity = "info" | "low" | "medium" | "high";
export type AuditCategory =
  | "semantic_discoverability"
  | "actionability"
  | "state_feedback"
  | "recoverability"
  | "agent_safety";

export interface AuditOptions {
  tasks?: AuditTask[];
  searchQuery?: string;
  timeoutMs?: number;
  redact?: Array<string | RegExp>;
  maxTextLength?: number;
}

export interface AuditConfig extends AuditOptions {
  failBelow?: number;
  output?: {
    json?: string;
    html?: string;
    markdown?: string;
  };
}

export interface AuditIssue {
  id: string;
  ruleId: string;
  severity: AuditSeverity;
  category: AuditCategory;
  title: string;
  message: string;
  evidence?: Record<string, unknown>;
  recommendation?: string;
  helpUrl?: string;
}

export interface AuditScores {
  overall: number;
  semanticDiscoverability: number;
  actionability: number;
  stateFeedback: number;
  recoverability: number;
  agentSafety: number;
}

export interface AuditTaskProbe {
  task: AuditTask;
  status: "passed" | "failed" | "skipped";
  steps: number;
  observedEffects: string[];
  error: string | null;
  evidence?: Record<string, unknown>;
}

export interface SemanticIdentity {
  elementInstanceId: string;
  semanticElementId: string;
  locatorFingerprint: string;
  lineage: string[];
}

export interface StructuredElement extends SemanticIdentity {
  id: string;
  role?: string;
  name: string;
}

export interface StructuredInput extends SemanticIdentity {
  id: string;
  label: string;
  type?: string;
}

export interface StructuredLink extends SemanticIdentity {
  id: string;
  name: string;
  href?: string;
}

export interface StructuredHeading extends SemanticIdentity {
  id: string;
  level: number;
  text: string;
}

export interface StructuredForm extends SemanticIdentity {
  id: string;
  name: string;
}

export type AuditTarget =
  | { kind: "role"; role: string; name?: string; exact?: boolean }
  | { kind: "label"; value: string; exact?: boolean }
  | { kind: "text"; value: string; exact?: boolean }
  | { kind: "testId"; value: string }
  | { kind: "css"; selector: string; internal?: boolean };

export type AuditWaitCondition =
  | { kind: "text"; value: string; exact?: boolean }
  | { kind: "urlIncludes"; value: string }
  | { kind: "titleIncludes"; value: string }
  | { kind: "targetVisible"; target: AuditTarget }
  | { kind: "loadState"; state: "load" | "domcontentloaded" | "networkidle" }
  | { kind: "timeout"; ms: number };

export interface AvailableAction {
  id: string;
  action: "click" | "fill" | "press" | "navigate";
  target?: AuditTarget;
  description: string;
}

export interface ActionGraphAction {
  actionId: string;
  kind: "click" | "submit_form" | "navigate" | "open_link" | "toggle" | "focus" | "download" | "dismiss_dialog";
  label?: string;
  targetElementId?: string;
  preconditions?: string[];
  effects?: string[];
  confidence?: number;
}

export interface IntentRegion {
  regionId: string;
  kind:
    | "search_interface"
    | "auth_form"
    | "results_list"
    | "navigation_bar"
    | "modal_dialog"
    | "primary_content"
    | "secondary_content";
  title?: string;
  primaryActions: string[];
  elements: string[];
}

export interface StructuredState {
  stateId: string;
  sessionId: string;
  pageId: string;
  url: string;
  title: string;
  buttons: StructuredElement[];
  inputs: StructuredInput[];
  links: StructuredLink[];
  headings: StructuredHeading[];
  forms: StructuredForm[];
  visibleTextSummary: string[];
  availableActions: AvailableAction[];
  actionGraph: { actions: ActionGraphAction[] };
  regions: IntentRegion[];
  timestamp: string;
}

export interface AuditReport {
  reportId: string;
  url: string;
  finalUrl: string;
  title: string;
  generatedAt: string;
  scores: AuditScores;
  issues: AuditIssue[];
  taskProbes: AuditTaskProbe[];
  state: StructuredState;
  metadata: {
    packageName: "agentability-audit";
    reportVersion: "0.1";
    observationBackend: "dom_semantic";
    localOnly: true;
  };
}

export interface AuditBrowserDriver {
  readonly sessionId: string;
  readonly pageId: string;
  openPage(url: string, options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeoutMs?: number }): Promise<void>;
  click(target: AuditTarget, timeoutMs?: number): Promise<void>;
  fill(target: AuditTarget, value: string, timeoutMs?: number): Promise<void>;
  press(key: string, target?: AuditTarget, timeoutMs?: number): Promise<void>;
  waitFor(condition: AuditWaitCondition, timeoutMs?: number): Promise<void>;
  extractText(target?: AuditTarget): Promise<string>;
  getStructuredState(): Promise<StructuredState>;
  getCurrentUrl(): Promise<string>;
  getTitle(): Promise<string>;
  getLogs(): string[];
  close(): Promise<void>;
}

export type BrowserDriverFactory = () => AuditBrowserDriver;

export interface AgentabilityAuditorOptions {
  driverFactory?: BrowserDriverFactory;
}

interface InternalIssueInput {
  severity: AuditSeverity;
  category: AuditCategory;
  title: string;
  message: string;
  evidence?: Record<string, unknown>;
  recommendation?: string;
}

export class AgentabilityAuditor {
  private readonly driverFactory: BrowserDriverFactory;

  constructor(options: AgentabilityAuditorOptions = {}) {
    this.driverFactory = options.driverFactory ?? (() => new PlaywrightBrowserDriver());
  }

  async auditUrl(url: string, options: AuditOptions = {}): Promise<AuditReport> {
    const driver = this.driverFactory();
    try {
      await driver.openPage(url, { waitUntil: "domcontentloaded", timeoutMs: options.timeoutMs ?? 30000 });
      return await auditDriver(driver, url, options);
    } finally {
      await driver.close();
    }
  }
}

export async function auditUrl(url: string, options: AuditOptions = {}): Promise<AuditReport> {
  return new AgentabilityAuditor().auditUrl(url, options);
}

export async function auditHtml(html: string, options: AuditOptions = {}): Promise<AuditReport> {
  const browser = await chromium.launch({
    headless: process.env.ARB_HEADLESS !== "false"
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 }
  });
  const page = await context.newPage();
  try {
    await page.setContent(html, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs ?? 30000
    });
    return await auditDriver(new PlaywrightPageAuditDriver(page), "about:blank#agentability-html", options);
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

export async function auditPage(page: Page, options: AuditOptions = {}): Promise<AuditReport> {
  const driver = new PlaywrightPageAuditDriver(page);
  return auditDriver(driver, page.url(), options);
}

export function normalizeAuditOptions(options: AuditOptions = {}): Required<Pick<AuditOptions, "tasks" | "searchQuery" | "timeoutMs" | "redact" | "maxTextLength">> {
  const timeoutMs = options.timeoutMs ?? 30000;
  const maxTextLength = options.maxTextLength ?? 12000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid timeoutMs: ${options.timeoutMs}`);
  }
  if (!Number.isFinite(maxTextLength) || maxTextLength <= 0) {
    throw new Error(`Invalid maxTextLength: ${options.maxTextLength}`);
  }
  return {
    tasks: normalizeAuditTasks(options.tasks),
    searchQuery: options.searchQuery ?? "Richmond ramen",
    timeoutMs,
    redact: options.redact ?? defaultRedactions(),
    maxTextLength
  };
}

async function auditDriver(driver: AuditBrowserDriver, url: string, options: AuditOptions): Promise<AuditReport> {
  const normalized = normalizeAuditOptions(options);
  const taskProbes: AuditTaskProbe[] = [];
  const initialRawState = await driver.getStructuredState();
  const initialState = redactState(initialRawState, normalized);

  for (const task of normalized.tasks) {
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
      taskProbes.push(await runSearchProbe(driver, initialRawState, normalized.searchQuery, normalized));
    }
  }

  const finalState = redactState(await driver.getStructuredState(), normalized);
  const issues = buildIssues(finalState, taskProbes);

  return {
    reportId: crypto.randomUUID(),
    url: redactText(url, normalized.redact),
    finalUrl: finalState.url,
    title: finalState.title,
    generatedAt: new Date().toISOString(),
    scores: scoreReport(finalState, issues, taskProbes),
    issues,
    taskProbes,
    state: finalState,
    metadata: {
      packageName: "agentability-audit",
      reportVersion: "0.1",
      observationBackend: "dom_semantic",
      localOnly: true
    }
  };
}

async function runSearchProbe(
  driver: AuditBrowserDriver,
  beforeState: StructuredState,
  query: string,
  options: Required<Pick<AuditOptions, "tasks" | "searchQuery" | "timeoutMs" | "redact" | "maxTextLength">>
): Promise<AuditTaskProbe> {
  const input = findSearchInput(beforeState);
  if (!input) {
    return {
      task: "search",
      status: "skipped",
      steps: 0,
      observedEffects: [],
      error: "No search-like input was found in structured state.",
      evidence: {
        inputLabels: beforeState.inputs.map((candidate) => redactText(candidate.label, options.redact))
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
        inputLabel: redactText(input.label, options.redact),
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
        inputLabel: redactText(input.label, options.redact)
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
      message: "The audit engine could not infer any executable page actions.",
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

class PlaywrightPageAuditDriver implements AuditBrowserDriver {
  readonly sessionId = crypto.randomUUID();
  readonly pageId = crypto.randomUUID();
  private readonly logs: string[] = [];

  constructor(private readonly page: Page) {}

  async openPage(url: string, options: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeoutMs?: number } = {}): Promise<void> {
    this.log(`navigate ${url}`);
    await this.page.goto(url, {
      waitUntil: options.waitUntil ?? "domcontentloaded",
      timeout: options.timeoutMs ?? 30000
    });
  }

  async click(target: AuditTarget, timeoutMs = 30000): Promise<void> {
    const locator = this.resolveLocator(target).first();
    this.log(`click ${target.kind}`);
    await locator.waitFor({ state: "visible", timeout: timeoutMs });
    await locator.click({ timeout: timeoutMs });
    await this.page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined);
  }

  async fill(target: AuditTarget, value: string, timeoutMs = 30000): Promise<void> {
    const locator = this.resolveLocator(target).first();
    this.log(`fill ${target.kind}`);
    await locator.waitFor({ state: "visible", timeout: timeoutMs });
    await locator.fill(value, { timeout: timeoutMs });
  }

  async press(key: string, target?: AuditTarget, timeoutMs = 30000): Promise<void> {
    this.log(`press ${key}`);
    if (target) {
      const locator = this.resolveLocator(target).first();
      await locator.waitFor({ state: "visible", timeout: timeoutMs });
      await locator.press(key, { timeout: timeoutMs });
    } else {
      await this.page.keyboard.press(key);
    }
    await this.page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined);
  }

  async waitFor(condition: AuditWaitCondition, timeoutMs = 30000): Promise<void> {
    this.log(`waitFor ${condition.kind}`);
    switch (condition.kind) {
      case "text":
        await this.page.getByText(condition.value, { exact: condition.exact ?? false }).first().waitFor({
          state: "visible",
          timeout: timeoutMs
        });
        return;
      case "urlIncludes":
        await this.page.waitForFunction((value) => window.location.href.includes(value), condition.value, {
          timeout: timeoutMs
        });
        return;
      case "titleIncludes":
        await this.page.waitForFunction((value) => document.title.includes(value), condition.value, {
          timeout: timeoutMs
        });
        return;
      case "targetVisible":
        await this.resolveLocator(condition.target).first().waitFor({ state: "visible", timeout: timeoutMs });
        return;
      case "loadState":
        await this.page.waitForLoadState(condition.state, { timeout: timeoutMs });
        return;
      case "timeout":
        await this.page.waitForTimeout(condition.ms);
        return;
    }
  }

  async extractText(target?: AuditTarget): Promise<string> {
    if (!target) {
      return this.page.locator("body").innerText({ timeout: 10000 });
    }
    return this.resolveLocator(target).first().innerText({ timeout: 10000 });
  }

  async getStructuredState(): Promise<StructuredState> {
    const source = buildStructuredStateFromDocument.toString();
    return this.page.evaluate(
      ({ fnSource, meta }) => {
        const build = new Function(`const __name = (fn) => fn; return (${fnSource})`)() as typeof buildStructuredStateFromDocument;
        return build(document, meta);
      },
      {
        fnSource: source,
        meta: {
          sessionId: this.sessionId,
          pageId: this.pageId
        }
      }
    );
  }

  async getCurrentUrl(): Promise<string> {
    return this.page.url();
  }

  async getTitle(): Promise<string> {
    return this.page.title();
  }

  getLogs(): string[] {
    return [...this.logs];
  }

  async close(): Promise<void> {
    // The caller owns the Playwright Page lifecycle.
  }

  private resolveLocator(target: AuditTarget) {
    switch (target.kind) {
      case "role":
        return this.page.getByRole(target.role as Parameters<Page["getByRole"]>[0], {
          name: target.name,
          exact: target.exact ?? false
        });
      case "label":
        return this.page.getByLabel(target.value, { exact: target.exact ?? false });
      case "text":
        return this.page.getByText(target.value, { exact: target.exact ?? false });
      case "testId":
        return this.page.getByTestId(target.value);
      case "css":
        return this.page.locator(target.selector);
    }
  }

  private log(message: string): void {
    this.logs.push(`[${new Date().toISOString()}] ${message}`);
  }
}

function findSearchInput(state: StructuredState): StructuredState["inputs"][number] | undefined {
  return state.inputs.find((input) => /search|query|q\b/i.test(`${input.label} ${input.type ?? ""}`));
}

function targetForInput(input: StructuredState["inputs"][number]): AuditTarget {
  if (input.label && !/^input \d+$/i.test(input.label)) {
    return { kind: "label", value: input.label, exact: true };
  }
  return { kind: "css", selector: input.locatorFingerprint || "input", internal: true };
}

function issue(id: string, input: InternalIssueInput): AuditIssue {
  return {
    id,
    ruleId: `${input.category}/${id}`,
    helpUrl: `https://github.com/yul761/AgentRunTimeBrowser#${id}`,
    ...input
  };
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

function normalizeAuditTasks(tasks: AuditTask[] | undefined): AuditTask[] {
  if (!tasks || tasks.length === 0) {
    return ["page"];
  }
  const taskNames = tasks as string[];
  const invalid = taskNames.filter((task) => task !== "page" && task !== "search");
  if (invalid.length > 0) {
    throw new Error(`Unsupported audit task probe: ${invalid.join(", ")}`);
  }
  return tasks;
}

function hasExplicitSponsoredRegion(state: StructuredState): boolean {
  return state.regions.some((region) => /sponsored|advertis/i.test(region.title ?? ""));
}

function penaltyFor(issues: AuditIssue[], category: AuditCategory): number {
  return issues
    .filter((issueItem) => issueItem.category === category)
    .reduce((total, issueItem) => total + severityPenalty(issueItem.severity), 0);
}

function severityPenalty(severity: AuditSeverity): number {
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

function redactState(
  state: StructuredState,
  options: Required<Pick<AuditOptions, "tasks" | "searchQuery" | "timeoutMs" | "redact" | "maxTextLength">>
): StructuredState {
  const redact = (value: string) => redactText(value, options.redact);
  return {
    ...state,
    url: redact(state.url),
    title: redact(state.title),
    buttons: state.buttons.map((button) => ({ ...redactIdentity(button, options.redact), name: redact(button.name) })),
    inputs: state.inputs.map((input) => ({ ...redactIdentity(input, options.redact), label: redact(input.label) })),
    links: state.links.map((link) => ({
      ...redactIdentity(link, options.redact),
      name: redact(link.name),
      href: redactOptional(link.href, options.redact)
    })),
    headings: state.headings.map((heading) => ({ ...redactIdentity(heading, options.redact), text: redact(heading.text) })),
    forms: state.forms.map((form) => ({ ...redactIdentity(form, options.redact), name: redact(form.name) })),
    visibleTextSummary: state.visibleTextSummary.map(redact).join("\n").slice(0, options.maxTextLength).split("\n").filter(Boolean),
    availableActions: state.availableActions.map((action) => ({
      ...action,
      description: redact(action.description),
      target: action.target ? redactTarget(action.target, options.redact) : undefined
    })),
    actionGraph: {
      actions: state.actionGraph.actions.map((action) => ({
        ...action,
        label: redactOptional(action.label, options.redact)
      }))
    },
    regions: state.regions.map((region) => ({ ...region, title: redactOptional(region.title, options.redact) }))
  };
}

function redactIdentity<T extends SemanticIdentity>(identity: T, patterns: Array<string | RegExp>): T {
  return {
    ...identity,
    locatorFingerprint: redactText(identity.locatorFingerprint, patterns),
    lineage: identity.lineage.map((item) => redactText(item, patterns))
  };
}

function redactTarget(target: AuditTarget, patterns: Array<string | RegExp>): AuditTarget {
  switch (target.kind) {
    case "role":
      return { ...target, name: redactOptional(target.name, patterns) };
    case "label":
    case "text":
    case "testId":
      return { ...target, value: redactText(target.value, patterns) };
    case "css":
      return { ...target, selector: redactText(target.selector, patterns) };
  }
}

function redactOptional(value: string | undefined, patterns: Array<string | RegExp>): string | undefined {
  return value === undefined ? undefined : redactText(value, patterns);
}

function redactText(value: string, patterns: Array<string | RegExp>): string {
  return patterns.reduce<string>((next, pattern) => {
    if (typeof pattern === "string") {
      return next.replaceAll(pattern, "[redacted]");
    }
    return next.replace(pattern, "[redacted]");
  }, value);
}

function defaultRedactions(): Array<string | RegExp> {
  return [
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"'\s]+/gi
  ];
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
