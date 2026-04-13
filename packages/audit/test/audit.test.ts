import type { BrowserDriver } from "@arb/browser-driver";
import type { AssertCondition, StructuredState, Target, WaitCondition } from "@arb/schemas";
import { describe, expect, it } from "vitest";
import { AgentabilityAuditor } from "../src/index";

class MockDriver implements BrowserDriver {
  readonly sessionId = "session-audit";
  readonly pageId = "page-audit";
  readonly logs: string[] = [];
  private searched = false;

  async openPage(url: string): Promise<void> {
    this.logs.push(`open:${url}`);
  }

  async click(_target: Target): Promise<void> {
    this.logs.push("click");
  }

  async fill(_target: Target, value: string): Promise<void> {
    this.logs.push(`fill:${value}`);
  }

  async press(key: string): Promise<void> {
    this.logs.push(`press:${key}`);
    this.searched = true;
  }

  async waitFor(condition: WaitCondition): Promise<void> {
    this.logs.push(`wait:${condition.kind}`);
  }

  async assert(condition: AssertCondition): Promise<void> {
    this.logs.push(`assert:${condition.kind}`);
  }

  async extractText(): Promise<string> {
    return "Audit page text";
  }

  async getStructuredState(): Promise<StructuredState> {
    return state(this.searched);
  }

  async getCurrentUrl(): Promise<string> {
    return this.searched ? "https://example.com?q=Richmond%20ramen" : "https://example.com";
  }

  async getTitle(): Promise<string> {
    return "Agentability fixture";
  }

  getLogs(): string[] {
    return [...this.logs];
  }

  async getPreviewSnapshot(): Promise<null> {
    return null;
  }

  async close(): Promise<void> {
    this.logs.push("close");
  }
}

describe("agentability auditor", () => {
  it("scores structured state and records search probes", async () => {
    const driver = new MockDriver();
    const auditor = new AgentabilityAuditor(() => driver);

    const report = await auditor.auditUrl("https://example.com", {
      tasks: ["page", "search"],
      searchQuery: "Richmond ramen"
    });

    expect(report.scores.overall).toBeGreaterThan(0);
    expect(report.taskProbes).toEqual(
      expect.arrayContaining([expect.objectContaining({ task: "search", status: "passed" })])
    );
    expect(report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "duplicate-button-labels" })])
    );
    expect(driver.logs).toContain("fill:Richmond ramen");
  });
});

function identity(kind: string, label: string, index: number) {
  return {
    elementInstanceId: `inst-${kind}-${index}`,
    semanticElementId: `sem-${kind}-${index}`,
    locatorFingerprint: `${kind}:${label}`,
    lineage: ["body", kind]
  };
}

function state(searched: boolean): StructuredState {
  const url = searched ? "https://example.com?q=Richmond%20ramen" : "https://example.com";
  return {
    stateId: searched ? "state-after" : "state-before",
    sessionId: "session-audit",
    pageId: "page-audit",
    url,
    title: "Agentability fixture",
    buttons: [
      { id: "button-0", role: "button", name: "View details", ...identity("button", "View details", 0) },
      { id: "button-1", role: "button", name: "View details", ...identity("button", "View details", 1) }
    ],
    inputs: [{ id: "input-0", label: "Search", type: "search", ...identity("input", "Search", 0) }],
    links: [{ id: "link-0", name: "Result", href: "/result", ...identity("link", "Result", 0) }],
    headings: [{ id: "heading-0", level: 1, text: searched ? "Results" : "Search", ...identity("heading", "Search", 0) }],
    forms: [{ id: "form-0", name: "Search", ...identity("form", "Search", 0) }],
    visibleTextSummary: searched ? ["Results for Richmond ramen", "Sponsored"] : ["Search Richmond ramen", "Sponsored"],
    availableActions: [],
    actionGraph: {
      actions: [
        {
          actionId: "ag-input-0",
          kind: "focus",
          label: "Search",
          targetElementId: "sem-input-0",
          preconditions: ["target_visible"],
          effects: ["input_ready_for_text"],
          confidence: 0.8
        },
        {
          actionId: "ag-button-0",
          kind: "click",
          label: "View details",
          targetElementId: "sem-button-0",
          preconditions: ["target_visible"],
          effects: ["element_activated"],
          confidence: 0.8
        },
        {
          actionId: "ag-button-1",
          kind: "click",
          label: "View details",
          targetElementId: "sem-button-1",
          preconditions: ["target_visible"],
          effects: ["element_activated"],
          confidence: 0.8
        }
      ]
    },
    regions: [
      {
        regionId: "region-primary",
        kind: "primary_content",
        title: "Main",
        primaryActions: ["ag-input-0"],
        elements: ["sem-input-0", "sem-button-0", "sem-button-1"]
      },
      {
        regionId: "region-results",
        kind: "results_list",
        title: "Results",
        primaryActions: ["ag-button-0", "ag-button-1"],
        elements: ["sem-button-0", "sem-button-1"]
      }
    ],
    timestamp: "2026-04-12T00:00:00.000Z"
  };
}
