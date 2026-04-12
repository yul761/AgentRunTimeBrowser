import { RuntimeFailure, type PreviewSnapshot } from "@arb/core";
import type { AssertCondition, StructuredState, Target, WaitCondition } from "@arb/schemas";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { buildStructuredStateFromDocument } from "./structured-state";

export interface NavigateOptions {
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  timeoutMs?: number;
}

export interface BrowserDriver {
  readonly sessionId: string;
  readonly pageId: string;
  openPage(url: string, options?: NavigateOptions): Promise<void>;
  click(target: Target, timeoutMs?: number): Promise<void>;
  fill(target: Target, value: string, timeoutMs?: number): Promise<void>;
  press(key: string, target?: Target, timeoutMs?: number): Promise<void>;
  waitFor(condition: WaitCondition, timeoutMs?: number): Promise<void>;
  assert(condition: AssertCondition, timeoutMs?: number): Promise<void>;
  extractText(target?: Target): Promise<string>;
  getStructuredState(): Promise<StructuredState>;
  getCurrentUrl(): Promise<string>;
  getTitle(): Promise<string>;
  getLogs(): string[];
  getPreviewSnapshot(): Promise<PreviewSnapshot | null>;
  close(): Promise<void>;
}

export class PlaywrightBrowserDriver implements BrowserDriver {
  readonly sessionId = crypto.randomUUID();
  readonly pageId = crypto.randomUUID();

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly logs: string[] = [];

  async openPage(url: string, options: NavigateOptions = {}): Promise<void> {
    const page = await this.ensurePage();
    this.log(`navigate ${url}`);
    try {
      await page.goto(url, {
        waitUntil: options.waitUntil ?? "domcontentloaded",
        timeout: options.timeoutMs ?? 30000
      });
    } catch (error) {
      throw new RuntimeFailure("NAVIGATION_FAILED", `Navigation failed for ${url}`, {
        details: { url },
        cause: error
      });
    }
  }

  async click(target: Target, timeoutMs = 30000): Promise<void> {
    const page = await this.ensurePage();
    const locator = await this.resolveVisibleLocator(target, timeoutMs);
    this.log(`click ${describeTarget(target)}`);
    await locator.click({ timeout: timeoutMs });
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined);
  }

  async fill(target: Target, value: string, timeoutMs = 30000): Promise<void> {
    const locator = await this.resolveVisibleLocator(target, timeoutMs);
    this.log(`fill ${describeTarget(target)}`);
    await locator.fill(value, { timeout: timeoutMs });
  }

  async press(key: string, target?: Target, timeoutMs = 30000): Promise<void> {
    const page = await this.ensurePage();
    this.log(`press ${key}`);
    if (target) {
      const locator = await this.resolveVisibleLocator(target, timeoutMs);
      await locator.press(key, { timeout: timeoutMs });
    } else {
      await page.keyboard.press(key);
    }
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined);
  }

  async waitFor(condition: WaitCondition, timeoutMs = 30000): Promise<void> {
    const page = await this.ensurePage();
    this.log(`waitFor ${condition.kind}`);
    switch (condition.kind) {
      case "text":
        await page.getByText(condition.value, { exact: condition.exact ?? false }).first().waitFor({
          state: "visible",
          timeout: timeoutMs
        });
        return;
      case "urlIncludes":
        await page.waitForFunction((value) => window.location.href.includes(value), condition.value, {
          timeout: timeoutMs
        });
        return;
      case "titleIncludes":
        await page.waitForFunction((value) => document.title.includes(value), condition.value, {
          timeout: timeoutMs
        });
        return;
      case "targetVisible":
        await this.resolveVisibleLocator(condition.target, timeoutMs);
        return;
      case "loadState":
        await page.waitForLoadState(condition.state, { timeout: timeoutMs });
        return;
      case "timeout":
        await page.waitForTimeout(condition.ms);
        return;
    }
  }

  async assert(condition: AssertCondition, timeoutMs = 5000): Promise<void> {
    const page = await this.ensurePage();
    this.log(`assert ${condition.kind}`);
    try {
      switch (condition.kind) {
        case "text":
          await page.getByText(condition.value, { exact: condition.exact ?? false }).first().waitFor({
            state: "visible",
            timeout: timeoutMs
          });
          return;
        case "urlIncludes":
          if (!page.url().includes(condition.value)) {
            throw new Error(`Expected URL to include "${condition.value}", got "${page.url()}"`);
          }
          return;
        case "titleIncludes": {
          const title = await page.title();
          if (!title.includes(condition.value)) {
            throw new Error(`Expected title to include "${condition.value}", got "${title}"`);
          }
          return;
        }
        case "targetVisible":
          await this.resolveVisibleLocator(condition.target, timeoutMs);
          return;
      }
    } catch (error) {
      throw new RuntimeFailure("ASSERTION_FAILED", `Assertion failed: ${condition.kind}`, {
        details: { condition },
        cause: error
      });
    }
  }

  async extractText(target?: Target): Promise<string> {
    const page = await this.ensurePage();
    if (!target) {
      return page.locator("body").innerText({ timeout: 10000 });
    }
    const locator = await this.resolveVisibleLocator(target, 10000);
    return locator.innerText({ timeout: 10000 });
  }

  async getStructuredState(): Promise<StructuredState> {
    const page = await this.ensurePage();
    const source = buildStructuredStateFromDocument.toString();
    return page.evaluate(
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
    const page = await this.ensurePage();
    return page.url();
  }

  async getTitle(): Promise<string> {
    const page = await this.ensurePage();
    return page.title();
  }

  getLogs(): string[] {
    return [...this.logs];
  }

  async getPreviewSnapshot(): Promise<PreviewSnapshot | null> {
    const page = await this.ensurePage();
    try {
      const buffer = await page.screenshot({
        type: "png",
        fullPage: false,
        timeout: 5000
      });
      return {
        mimeType: "image/png",
        dataBase64: buffer.toString("base64"),
        capturedAt: new Date().toISOString()
      };
    } catch (error) {
      this.log(`snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.page = null;
    this.context = null;
    this.browser = null;
  }

  private async ensurePage(): Promise<Page> {
    if (this.page) {
      return this.page;
    }

    this.browser = await chromium.launch({
      headless: process.env.ARB_HEADLESS !== "false"
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 900 }
    });
    this.page = await this.context.newPage();
    this.page.on("console", (message) => {
      this.log(`browser console ${message.type()}: ${message.text()}`);
    });
    this.page.on("pageerror", (error) => {
      this.log(`page error: ${error.message}`);
    });
    return this.page;
  }

  private resolveLocator(target: Target): Locator {
    if (!this.page) {
      throw new RuntimeFailure("INTERNAL_ERROR", "Browser page has not been initialized");
    }

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

  private async resolveVisibleLocator(target: Target, timeoutMs: number): Promise<Locator> {
    await this.ensurePage();
    const attempts = 3;
    const perAttemptTimeout = Math.max(500, Math.floor(timeoutMs / attempts));
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const locator = this.resolveLocator(target).first();
      try {
        await locator.waitFor({ state: "visible", timeout: perAttemptTimeout });
        return locator;
      } catch (error) {
        lastError = error;
        await this.page?.waitForTimeout(250);
      }
    }

    throw new RuntimeFailure("TARGET_NOT_FOUND", `Target not found: ${describeTarget(target)}`, {
      details: { target },
      cause: lastError
    });
  }

  private log(message: string): void {
    this.logs.push(`[${new Date().toISOString()}] ${message}`);
  }
}

export function describeTarget(target: Target): string {
  switch (target.kind) {
    case "role":
      return `role=${target.role}${target.name ? ` name="${target.name}"` : ""}`;
    case "label":
      return `label="${target.value}"`;
    case "text":
      return `text="${target.value}"`;
    case "testId":
      return `testId="${target.value}"`;
    case "css":
      return `css="${target.selector}"`;
  }
}

export { buildStructuredStateFromDocument };
