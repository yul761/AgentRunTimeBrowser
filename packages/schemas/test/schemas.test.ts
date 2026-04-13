import { describe, expect, it } from "vitest";
import { AuditReportSchema, TaskStepSchema, TaskSubmissionSchema } from "../src/index";

describe("task submission schema", () => {
  it("accepts explicit workflow tasks", () => {
    const result = TaskSubmissionSchema.safeParse({
      taskType: "workflow.execute",
      input: {
        steps: [
          { action: "navigate", url: "https://www.google.com" },
          {
            action: "fill",
            target: { kind: "role", role: "textbox", name: "Search" },
            value: "Richmond ramen"
          },
          { action: "press", key: "Enter" },
          { action: "waitFor", condition: { kind: "text", value: "ramen" } }
        ]
      }
    });

    expect(result.success).toBe(true);
  });

  it("accepts deterministic web search tasks", () => {
    const result = TaskSubmissionSchema.safeParse({
      taskType: "web.search",
      input: {
        engine: "google",
        query: "Richmond ramen"
      }
    });

    expect(result.success).toBe(true);
  });

  it("accepts explicit runtime observation options", () => {
    const result = TaskSubmissionSchema.safeParse({
      taskType: "workflow.execute",
      runtime: {
        capturePreview: false,
        captureEvidence: false,
        observationProfile: "interactive_only"
      },
      input: {
        steps: [{ action: "navigate", url: "https://example.com" }]
      }
    });

    expect(result.success).toBe(true);
  });

  it("rejects free-form natural language tasks", () => {
    const result = TaskSubmissionSchema.safeParse({
      taskType: "chat",
      input: "find ramen in Richmond"
    });

    expect(result.success).toBe(false);
  });

  it("rejects unsupported step actions", () => {
    const result = TaskStepSchema.safeParse({
      action: "summarizePage",
      prompt: "What is this page?"
    });

    expect(result.success).toBe(false);
  });

  it("rejects malformed step targets", () => {
    const result = TaskStepSchema.safeParse({
      action: "click",
      target: { kind: "role" }
    });

    expect(result.success).toBe(false);
  });

  it("accepts agentability audit reports", () => {
    const result = AuditReportSchema.safeParse({
      reportId: "audit-1",
      url: "https://example.com",
      finalUrl: "https://example.com",
      title: "Example",
      generatedAt: "2026-04-12T00:00:00.000Z",
      scores: {
        overall: 88,
        semanticDiscoverability: 90,
        actionability: 80,
        stateFeedback: 85,
        recoverability: 95,
        agentSafety: 90
      },
      issues: [
        {
          id: "duplicate-button-labels",
          severity: "medium",
          category: "actionability",
          title: "Duplicate labels",
          message: "Repeated controls need better labels."
        }
      ],
      taskProbes: [
        {
          task: "page",
          status: "passed",
          steps: 1,
          observedEffects: ["structured_state_captured"],
          error: null
        }
      ],
      state: {
        stateId: "state-1",
        sessionId: "session-1",
        pageId: "page-1",
        url: "https://example.com",
        title: "Example",
        buttons: [],
        inputs: [],
        links: [],
        headings: [],
        forms: [],
        visibleTextSummary: [],
        availableActions: [],
        actionGraph: { actions: [] },
        regions: [],
        timestamp: "2026-04-12T00:00:00.000Z"
      }
    });

    expect(result.success).toBe(true);
  });
});
