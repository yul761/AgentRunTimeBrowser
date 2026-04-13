import { chromium, type Browser, type Page } from "playwright";
import { z } from "zod";
import type { Action, BenchmarkResult, BenchmarkTarget, StepLog } from "./types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4.1-mini";
const MAX_STEPS = 8;
const FIXED_QUERY = "Richmond ramen";
const FIXTURE_URL = new URL("./search-fixture.html", import.meta.url).href;
const LIVE_WEB_URL = `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(
  FIXED_QUERY
)}&title=Special%3ASearch&fulltext=1&ns0=1`;

const BenchmarkTargetSchema = z.enum(["google", "fixture", "live_web", "complex_fixture"]);

const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fill_search"), query: z.string().min(1) }),
  z.object({ type: z.literal("press_enter") }),
  z.object({ type: z.literal("toggle_open_now") }),
  z.object({ type: z.literal("sort_by_rating") }),
  z.object({ type: z.literal("apply_filters") }),
  z.object({ type: z.literal("extract_results") }),
  z.object({ type: z.literal("done") })
]);

const ActionAliasSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("fill_search"), query: z.string().min(1) }),
  z.object({ action: z.literal("press_enter") }),
  z.object({ action: z.literal("toggle_open_now") }),
  z.object({ action: z.literal("sort_by_rating") }),
  z.object({ action: z.literal("apply_filters") }),
  z.object({ action: z.literal("extract_results") }),
  z.object({ action: z.literal("done") })
]);

const ActionEnvelopeSchema = z.object({
  action: ActionSchema
}).transform((value) => value.action);

const ResponsesApiSchema = z.object({
  output_text: z.string().optional(),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional()
    })
    .optional()
}).passthrough();

interface Observation {
  url: string;
  title: string;
  visibleText: string;
  interactiveElements: InteractiveElement[];
}

interface InteractiveElement {
  tag: string;
  text: string;
  aria: string;
  placeholder: string;
  name: string;
  value: string;
}

interface ModelDecision {
  action: Action;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
}

interface ActionExecutionResult {
  extractedResults: string[];
  googleBlocked: boolean;
  fallbackUsed: boolean;
  note?: string;
}

export async function runBaselineAgent(): Promise<BenchmarkResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required to run the baseline benchmark.");
  }

  const model = process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
  const target = BenchmarkTargetSchema.parse(process.env.BASELINE_TARGET ?? "google");
  const browser = await chromium.launch({ headless: process.env.ARB_HEADLESS !== "false" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const steps: StepLog[] = [];
  let extractedResults: string[] = [];
  let liveGoogleStatus: BenchmarkResult["liveGoogleStatus"] = "ok";
  let fallbackUsed = false;

  try {
    await page.goto(startUrlForTarget(target), { waitUntil: "domcontentloaded", timeout: 30000 });

    for (let step = 1; step <= MAX_STEPS; step += 1) {
      let observation = await observePage(page);
      let preDecisionGoogleBlocked = false;
      let preDecisionFallbackUsed = false;
      let preDecisionNote: string | undefined;
      if (isGoogleBlockedUrl(observation.url)) {
        liveGoogleStatus = "blocked";
        fallbackUsed = true;
        preDecisionGoogleBlocked = true;
        preDecisionFallbackUsed = true;
        preDecisionNote = "Google returned /sorry before the next model decision; loaded local search fixture fallback.";
        await loadFixtureSearchResults(page);
        observation = await observePage(page);
      }
      const decision = await decideNextAction({
        apiKey,
        model,
        target,
        step,
        observation,
        previousActions: steps.map((entry) => entry.action),
        extractedResults
      });

      const execution = await executeAction(page, decision.action);
      if (execution.googleBlocked) {
        liveGoogleStatus = "blocked";
      }
      if (execution.fallbackUsed) {
        fallbackUsed = true;
      }
      if (execution.extractedResults.length > 0) {
        extractedResults = execution.extractedResults;
      }

      steps.push({
        step,
        url: observation.url,
        title: observation.title,
        action: decision.action,
        inputTokens: decision.inputTokens,
        outputTokens: decision.outputTokens,
        totalTokens: decision.totalTokens,
        latencyMs: decision.latencyMs,
        extractedResults: execution.extractedResults.length > 0 ? execution.extractedResults : undefined,
        googleBlocked: execution.googleBlocked || preDecisionGoogleBlocked || undefined,
        fallbackUsed: execution.fallbackUsed || preDecisionFallbackUsed || undefined,
        note: [preDecisionNote, execution.note].filter((value): value is string => Boolean(value)).join(" ") || undefined
      });

      if (decision.action.type === "done") {
        break;
      }
      if (decision.action.type === "extract_results" && extractedResults.length >= 5) {
        break;
      }
    }

    return {
      steps,
      totalTokens: steps.reduce((sum, step) => sum + step.totalTokens, 0),
      totalLatencyMs: steps.reduce((sum, step) => sum + step.latencyMs, 0),
      extractedResults,
      target,
      liveGoogleStatus,
      fallbackUsed,
      blockReason: liveGoogleStatus === "blocked" ? "Google returned the /sorry anti-automation challenge page." : undefined
    };
  } finally {
    await closeBrowser(browser);
  }
}

async function observePage(page: Page): Promise<Observation> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await observePageOnce(page);
    } catch (error) {
      if (attempt === 3 || !isNavigationContextError(error)) {
        throw error;
      }
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(250);
    }
  }

  throw new Error("Could not observe page.");
}

async function observePageOnce(page: Page): Promise<Observation> {
  const [url, title, visibleText, interactiveElements] = await Promise.all([
    Promise.resolve(page.url()),
    page.title(),
    page.locator("body").innerText({ timeout: 5000 }).catch(() => ""),
    page.evaluate(() => {
      const elements = Array.from(
        document.querySelectorAll("input, textarea, button, a, select, [role='button'], [role='link']")
      );
      return elements
        .slice(0, 40)
        .map((element) => {
          const htmlElement = element as HTMLInputElement;
          return {
            tag: element.tagName.toLowerCase(),
            text: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
            aria: element.getAttribute("aria-label") ?? "",
            placeholder: element.getAttribute("placeholder") ?? "",
            name: htmlElement.name ?? element.getAttribute("name") ?? "",
            value: htmlElement.value ?? ""
          };
        })
        .filter((element) => element.text || element.aria || element.placeholder || element.name || element.value);
    })
  ]);

  return {
    url,
    title,
    visibleText: visibleText.replace(/\s+/g, " ").trim().slice(0, 3000),
    interactiveElements
  };
}

function isNavigationContextError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Execution context was destroyed");
}

async function decideNextAction(input: {
  apiKey: string;
  model: string;
  target: BenchmarkTarget;
  step: number;
  observation: Observation;
  previousActions: Action[];
  extractedResults: string[];
}): Promise<ModelDecision> {
  const startedAt = Date.now();
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: input.model,
      input: [
        {
          role: "system",
          content:
            `You are a benchmark browser agent. Return only JSON for the next action. Valid actions: fill_search { query }, press_enter, toggle_open_now, sort_by_rating, apply_filters, extract_results, done. The fixed task is: ${taskDescriptionForTarget(input.target)}. ${decisionRulesForTarget(input.target)} Do not repeat an action that already succeeded.`
        },
        {
          role: "user",
          content: JSON.stringify({
            step: input.step,
            maxSteps: MAX_STEPS,
            previousActions: input.previousActions,
            extractedResults: input.extractedResults,
            observation: input.observation
          })
        }
      ],
      text: {
        format: {
          type: "json_object"
        }
      }
    })
  });
  const latencyMs = Date.now() - startedAt;
  const body = await response.json() as unknown;

  if (!response.ok) {
    throw new Error(`OpenAI Responses API failed (${response.status}): ${JSON.stringify(body)}`);
  }

  const parsedResponse = ResponsesApiSchema.parse(body);
  const action = parseAction(extractResponseText(parsedResponse, body));

  return {
    action,
    inputTokens: parsedResponse.usage?.input_tokens ?? 0,
    outputTokens: parsedResponse.usage?.output_tokens ?? 0,
    totalTokens: parsedResponse.usage?.total_tokens ?? 0,
    latencyMs
  };
}

function startUrlForTarget(target: BenchmarkTarget): string {
  if (target === "fixture" || target === "complex_fixture") {
    return FIXTURE_URL;
  }
  if (target === "live_web") {
    return LIVE_WEB_URL;
  }
  return "https://www.google.com";
}

function taskDescriptionForTarget(target: BenchmarkTarget): string {
  if (target === "fixture") {
    return "use the complex local search fixture and extract the top 5 Richmond ramen result titles";
  }
  if (target === "complex_fixture") {
    return "use the local search fixture, fill Richmond ramen, enable Open now, sort by rating, apply filters, and extract the top 5 result titles";
  }
  if (target === "live_web") {
    return "use the live Wikipedia search page for Richmond ramen and extract the top 5 result titles";
  }
  return "open Google, search Richmond ramen, extract top 5 result titles";
}

function decisionRulesForTarget(target: BenchmarkTarget): string {
  if (target === "complex_fixture") {
    return "For complex_fixture, follow this exact action order unless the action is already in previousActions: fill_search, toggle_open_now, sort_by_rating, apply_filters, extract_results, done. Do not use press_enter for complex_fixture.";
  }

  if (target === "fixture" || target === "live_web") {
    return "If the page is already a search results page, Wikipedia Search page, or the title is Baseline Search Fixture, choose extract_results.";
  }

  return "If the query is already present in a search input value, choose press_enter. If the page is a search results page, choose extract_results.";
}

function extractResponseText(parsedResponse: z.infer<typeof ResponsesApiSchema>, rawBody: unknown): string {
  if (parsedResponse.output_text) {
    return parsedResponse.output_text;
  }

  const raw = rawBody as { output?: Array<{ content?: Array<{ text?: string }> }> };
  const text = raw.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text ?? "")
    .find((value) => value.trim().length > 0);

  if (!text) {
    throw new Error("OpenAI response did not include JSON output text.");
  }
  return text;
}

function parseAction(text: string): Action {
  const parsedJson = JSON.parse(text) as unknown;
  const directAction = ActionSchema.safeParse(parsedJson);
  if (directAction.success) {
    return directAction.data;
  }

  const envelopeAction = ActionEnvelopeSchema.safeParse(parsedJson);
  if (envelopeAction.success) {
    return envelopeAction.data;
  }

  const aliasAction = ActionAliasSchema.safeParse(parsedJson);
  if (aliasAction.success) {
    return normalizeAliasAction(aliasAction.data);
  }

  return ActionSchema.parse(parsedJson);
}

function normalizeAliasAction(action: z.infer<typeof ActionAliasSchema>): Action {
  switch (action.action) {
    case "fill_search":
      return { type: "fill_search", query: action.query };
    case "press_enter":
      return { type: "press_enter" };
    case "toggle_open_now":
      return { type: "toggle_open_now" };
    case "sort_by_rating":
      return { type: "sort_by_rating" };
    case "apply_filters":
      return { type: "apply_filters" };
    case "extract_results":
      return { type: "extract_results" };
    case "done":
      return { type: "done" };
  }
}

async function executeAction(page: Page, action: Action): Promise<ActionExecutionResult> {
  switch (action.type) {
    case "fill_search":
      await fillSearchInput(page, action.query);
      return emptyExecutionResult();
    case "press_enter":
      const beforeUrl = page.url();
      await page.keyboard.press("Enter");
      await page.waitForURL((url) => url.href !== beforeUrl, { timeout: 5000 }).catch(() => undefined);
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      if (isGoogleBlockedPage(page)) {
        await loadFixtureSearchResults(page);
        return {
          extractedResults: [],
          googleBlocked: true,
          fallbackUsed: true,
          note: "Google returned /sorry; loaded local search fixture fallback."
        };
      }
      return emptyExecutionResult();
    case "toggle_open_now":
      await page.getByLabel("Open now").check({ timeout: 5000 });
      return emptyExecutionResult();
    case "sort_by_rating":
      await page.getByRole("button", { name: "Sort by rating" }).click({ timeout: 5000 });
      return emptyExecutionResult();
    case "apply_filters":
      await page.getByRole("button", { name: "Apply filters" }).click({ timeout: 5000 });
      await page.getByText(/filtered results/i).first().waitFor({ state: "visible", timeout: 5000 });
      return emptyExecutionResult();
    case "extract_results":
      return {
        ...emptyExecutionResult(),
        extractedResults: await extractTopResultTitles(page)
      };
    case "done":
      return emptyExecutionResult();
  }
}

function emptyExecutionResult(): ActionExecutionResult {
  return {
    extractedResults: [],
    googleBlocked: false,
    fallbackUsed: false
  };
}

function isGoogleBlockedPage(page: Page): boolean {
  return isGoogleBlockedUrl(page.url());
}

function isGoogleBlockedUrl(url: string): boolean {
  return url.includes("google.com/sorry") || url.includes("/sorry/index");
}

async function loadFixtureSearchResults(page: Page): Promise<void> {
  await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded", timeout: 10000 });
}

async function fillSearchInput(page: Page, query: string): Promise<void> {
  const candidates = [
    page.locator("textarea[name='q']"),
    page.locator("input[name='q']"),
    page.locator("input[type='search']"),
    page.getByLabel("Search", { exact: true }),
    page.getByRole("combobox", { name: /search/i }),
    page.getByRole("textbox", { name: /search/i }),
    page.getByLabel(/search/i)
  ];

  for (const locator of candidates) {
    const first = locator.first();
    if (await first.isVisible({ timeout: 1500 }).catch(() => false)) {
      try {
        await first.fill(query);
        return;
      } catch {
        // Continue to narrower or later candidates when a broad accessible label matches a container.
      }
    }
  }

  throw new Error("Could not find a Google search input.");
}

async function extractTopResultTitles(page: Page): Promise<string[]> {
  await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => undefined);

  const titles = await uniqueNonEmptyText(page, "#results article.result > a h3, .mw-search-result-heading > a:first-of-type");
  if (titles.length >= 5) {
    return titles.slice(0, 5);
  }

  return uniqueNonEmptyText(page, "a h3, h3, .mw-search-result a").then((values) => values.slice(0, 5));
}

async function uniqueNonEmptyText(page: Page, selector: string): Promise<string[]> {
  const values = await page.locator(selector).allTextContents();
  const titles: string[] = [];
  for (const value of values) {
    const text = value.replace(/\s+/g, " ").trim();
    if (text && !titles.includes(text)) {
      titles.push(text);
    }
  }
  return titles;
}

async function closeBrowser(browser: Browser): Promise<void> {
  await browser.close().catch(() => undefined);
}
