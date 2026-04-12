import { describe, expect, it } from "vitest";
import { RuntimeFailure, normalizeRuntimeError } from "../src/index";

describe("runtime error normalization", () => {
  it("preserves explicit runtime failures", () => {
    const normalized = normalizeRuntimeError(new RuntimeFailure("TARGET_NOT_FOUND", "Search textbox not found"));

    expect(normalized.code).toBe("TARGET_NOT_FOUND");
    expect(normalized.message).toBe("Search textbox not found");
  });

  it("classifies common timeout errors", () => {
    const normalized = normalizeRuntimeError(new Error("Timeout 30000ms exceeded"));

    expect(normalized.code).toBe("ACTION_TIMEOUT");
  });

  it("falls back to internal errors", () => {
    const normalized = normalizeRuntimeError(new Error("unexpected failure"));

    expect(normalized.code).toBe("INTERNAL_ERROR");
  });

  it("preserves validation and assertion failures", () => {
    expect(normalizeRuntimeError(new RuntimeFailure("VALIDATION_ERROR", "bad input")).code).toBe("VALIDATION_ERROR");
    expect(normalizeRuntimeError(new RuntimeFailure("ASSERTION_FAILED", "assert failed")).code).toBe("ASSERTION_FAILED");
  });

  it("classifies navigation failures", () => {
    const normalized = normalizeRuntimeError(new Error("net::ERR_NAME_NOT_RESOLVED"));

    expect(normalized.code).toBe("NAVIGATION_FAILED");
  });
});
