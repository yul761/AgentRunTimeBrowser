import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { buildStructuredStateFromDocument } from "../src/index";

describe("structured state extraction", () => {
  it("extracts a compact semantic page summary", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <h1>Ramen Finder</h1>
      <form aria-label="Search form">
        <label for="query">Search</label>
        <input id="query" name="q" type="search" />
        <button type="submit">Find ramen</button>
      </form>
      <a href="/results">Results</a>
      <p>Richmond ramen options near transit.</p>
    `;

    const state = buildStructuredStateFromDocument(window.document as unknown as Document, {
      sessionId: "session-1",
      pageId: "page-1"
    });

    expect(state.stateId).toMatch(/^state-/);
    expect(state.headings[0]).toMatchObject({ level: 1, text: "Ramen Finder" });
    expect(state.inputs[0]).toMatchObject({ label: "Search", type: "search" });
    expect(state.buttons[0]).toMatchObject({ role: "button", name: "Find ramen" });
    expect(state.links[0]).toMatchObject({ name: "Results", href: "/results" });
    expect(state.buttons[0]?.semanticElementId).toMatch(/^sem-button-/);
    expect(state.buttons[0]?.locatorFingerprint).toContain("button");
    expect(state.buttons[0]?.lineage.length).toBeGreaterThan(0);
    expect(state.visibleTextSummary.join(" ")).toContain("Richmond ramen");
    expect(state.availableActions.some((action) => action.action === "fill")).toBe(true);
    expect(state.actionGraph.actions.some((action) => action.kind === "submit_form")).toBe(true);
    expect(state.actionGraph.actions.some((action) => action.kind === "focus")).toBe(true);
    expect(state.regions.some((region) => region.kind === "search_interface")).toBe(true);
  });
});
