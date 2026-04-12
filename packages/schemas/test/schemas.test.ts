import { describe, expect, it } from "vitest";
import { TaskStepSchema, TaskSubmissionSchema } from "../src/index";

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
});
