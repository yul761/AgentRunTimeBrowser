import type { BrowserDriver } from "@arb/browser-driver";
import { InMemoryTaskStore, RuntimeFailure, type PreviewSnapshot } from "@arb/core";
import type { AssertCondition, StructuredState, Target, WaitCondition } from "@arb/schemas";
import { describe, expect, it } from "vitest";
import { TaskEngine, planSteps } from "../src/index";

const identity = (kind: string, label: string, index: number) => ({
  elementInstanceId: `inst-page-1-${kind}-${index}`,
  semanticElementId: `sem-${kind}-${index}`,
  locatorFingerprint: `${kind}:${label}`,
  lineage: ["body", kind]
});

class MockDriver implements BrowserDriver {
  readonly sessionId = "session-1";
  readonly pageId = "page-1";
  readonly calls: string[] = [];
  failOnClick = false;

  async openPage(url: string): Promise<void> {
    this.calls.push(`navigate:${url}`);
  }

  async click(_target: Target): Promise<void> {
    this.calls.push("click");
    if (this.failOnClick) {
      throw new RuntimeFailure("TARGET_NOT_FOUND", "button missing");
    }
  }

  async fill(_target: Target, value: string): Promise<void> {
    this.calls.push(`fill:${value}`);
  }

  async press(key: string): Promise<void> {
    this.calls.push(`press:${key}`);
  }

  async waitFor(condition: WaitCondition): Promise<void> {
    this.calls.push(`waitFor:${condition.kind}`);
  }

  async assert(condition: AssertCondition): Promise<void> {
    this.calls.push(`assert:${condition.kind}`);
  }

  async extractText(): Promise<string> {
    this.calls.push("extractText");
    return "Example body text";
  }

  async getStructuredState(): Promise<StructuredState> {
    return {
      stateId: `state-${this.calls.length}`,
      sessionId: this.sessionId,
      pageId: this.pageId,
      url: "https://example.com",
      title: "Example",
      buttons: [{ id: "button-0", ...identity("button", "Submit", 0), role: "button", name: "Submit" }],
      inputs: [{ id: "input-0", ...identity("input", "Search", 0), label: "Search", type: "search" }],
      links: [{ id: "link-0", ...identity("link", "Docs", 0), name: "Docs", href: "/docs" }],
      headings: [{ id: "heading-0", ...identity("heading", "Example", 0), level: 1, text: "Example" }],
      forms: [{ id: "form-0", ...identity("form", "Search form", 0), name: "Search form" }],
      visibleTextSummary: ["Example body text"],
      availableActions: [],
      actionGraph: {
        actions: [
          {
            actionId: "ag-button-sem-button-0",
            kind: "submit_form",
            label: "Submit",
            targetElementId: "sem-button-0",
            preconditions: ["target_visible"],
            effects: ["form_may_submit"],
            confidence: 0.84
          }
        ]
      },
      regions: [
        {
          regionId: "region-search",
          kind: "search_interface",
          title: "Search form",
          primaryActions: ["ag-button-sem-button-0"],
          elements: ["sem-button-0", "sem-input-0"]
        }
      ],
      timestamp: new Date().toISOString()
    };
  }

  async getCurrentUrl(): Promise<string> {
    return "https://example.com";
  }

  async getTitle(): Promise<string> {
    return "Example";
  }

  getLogs(): string[] {
    return [...this.calls];
  }

  async getPreviewSnapshot(): Promise<PreviewSnapshot | null> {
    return null;
  }

  async close(): Promise<void> {
    this.calls.push("close");
  }
}

describe("task engine", () => {
  it("executes explicit workflow tasks and records progress", async () => {
    const store = new InMemoryTaskStore();
    const driver = new MockDriver();
    const engine = new TaskEngine(store, () => driver);

    const record = await engine.submitTask(
      {
        taskType: "workflow.execute",
        input: {
          steps: [
            { action: "navigate", url: "https://example.com" },
            { action: "fill", target: { kind: "label", value: "Search" }, value: "ramen" },
            { action: "extract", extract: { kind: "headings", name: "headings" } }
          ]
        }
      },
      { async: false }
    );

    expect(record.status).toBe("success");
    expect(record.completedSteps).toBe(3);
    expect(record.extractedData.headings).toMatchObject([{ level: 1, text: "Example" }]);
    expect(record.evidence).toHaveLength(3);
    expect(record.evidence[0]?.afterStateId).toMatch(/^state-/);
    expect(record.logs.some((log) => log.message.includes("Completed step 3"))).toBe(true);
    expect(driver.calls).toContain("fill:ramen");
  });

  it("translates web.search into deterministic workflow steps", () => {
    const steps = planSteps({
      taskType: "web.search",
      input: { engine: "google", query: "Richmond ramen" }
    });

    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatchObject({ action: "navigate" });
    expect(steps[0]?.action === "navigate" ? steps[0].url : "").toContain("google.com/search");
    expect(steps[2]).toMatchObject({ action: "extract", extract: { kind: "links", name: "searchResults" } });
  });

  it("normalizes driver failures into task errors", async () => {
    const store = new InMemoryTaskStore();
    const driver = new MockDriver();
    driver.failOnClick = true;
    const engine = new TaskEngine(store, () => driver);

    const record = await engine.submitTask(
      {
        taskType: "workflow.execute",
        input: {
          steps: [{ action: "click", target: { kind: "role", role: "button", name: "Missing" } }]
        }
      },
      { async: false }
    );

    expect(record.status).toBe("failed");
    expect(record.error?.code).toBe("TARGET_NOT_FOUND");
    expect(record.logs.some((log) => log.level === "error")).toBe(true);
  });
});
