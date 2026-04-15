import type { AuditCategory, AuditSeverity } from "./index";

export interface RuleMetadata {
  ruleId: string;
  id: string;
  category: AuditCategory;
  defaultSeverity: AuditSeverity;
  title: string;
  rationale: string;
  examples: string[];
  recommendation: string;
}

type RuleDefinition = Omit<RuleMetadata, "examples"> & { examples?: string[] };

export const RULES = [
  {
    id: "missing-input-labels",
    ruleId: "semantic_discoverability/missing-input-labels",
    category: "semantic_discoverability",
    defaultSeverity: "high",
    title: "Inputs need stable accessible labels",
    rationale: "Agents need stable names for fields so they can fill forms without CSS fallbacks.",
    recommendation: "Use visible labels, aria-label, or aria-labelledby for every input."
  },
  {
    id: "missing-button-names",
    ruleId: "semantic_discoverability/missing-button-names",
    category: "semantic_discoverability",
    defaultSeverity: "high",
    title: "Buttons need accessible names",
    rationale: "Icon-only or unnamed buttons make executable actions ambiguous.",
    recommendation: "Give buttons visible text or an aria-label."
  },
  {
    id: "missing-link-names",
    ruleId: "semantic_discoverability/missing-link-names",
    category: "semantic_discoverability",
    defaultSeverity: "medium",
    title: "Links need meaningful names",
    rationale: "Agents cannot reliably choose links when link text is empty or generic.",
    recommendation: "Use descriptive link text that identifies the destination or object."
  },
  {
    id: "duplicate-button-labels",
    ruleId: "actionability/duplicate-button-labels",
    category: "actionability",
    defaultSeverity: "medium",
    title: "Duplicate button labels make actions ambiguous",
    rationale: "Repeated controls with the same name are hard to target deterministically.",
    recommendation: "Include the object name in repeated controls, for example aria-label=\"View details for Ramen DANBO\"."
  },
  {
    id: "duplicate-link-labels",
    ruleId: "actionability/duplicate-link-labels",
    category: "actionability",
    defaultSeverity: "low",
    title: "Duplicate link labels reduce action precision",
    rationale: "Repeated links with identical names can point to different objects.",
    recommendation: "Prefer descriptive link text when repeated links perform different actions."
  },
  {
    id: "duplicate-action-labels",
    ruleId: "actionability/duplicate-action-labels",
    category: "actionability",
    defaultSeverity: "medium",
    title: "Action graph contains ambiguous action labels",
    rationale: "Agents need distinguishable action labels to select executable operations.",
    recommendation: "Make repeated actions distinguishable through names, labels, or stable data attributes."
  },
  {
    id: "empty-action-graph",
    ruleId: "actionability/empty-action-graph",
    category: "actionability",
    defaultSeverity: "high",
    title: "No executable actions were detected",
    rationale: "A page that exposes no actions is not actionable for structured agents.",
    recommendation: "Expose controls as semantic buttons, links, inputs, forms, and dialogs."
  },
  {
    id: "action-missing-target",
    ruleId: "actionability/action-missing-target",
    category: "actionability",
    defaultSeverity: "medium",
    title: "Action graph actions need target identity",
    rationale: "Actions without target element identity are hard to replay or debug.",
    recommendation: "Ensure inferred actions are attached to stable semantic elements."
  },
  {
    id: "low-confidence-actions",
    ruleId: "actionability/low-confidence-actions",
    category: "actionability",
    defaultSeverity: "low",
    title: "Low-confidence actions need stronger semantics",
    rationale: "Low-confidence inferred actions indicate weak element semantics.",
    recommendation: "Use semantic controls, stable labels, and explicit roles for interactive elements."
  },
  {
    id: "duplicate-locator-fingerprints",
    ruleId: "recoverability/duplicate-locator-fingerprints",
    category: "recoverability",
    defaultSeverity: "medium",
    title: "Locator fingerprints should be stable and unique",
    rationale: "Duplicate locator fingerprints reduce replay reliability after rerenders.",
    recommendation: "Prefer stable IDs, data-testid values, names, or unique labels for repeated controls."
  },
  {
    id: "missing-primary-content-region",
    ruleId: "semantic_discoverability/missing-primary-content-region",
    category: "semantic_discoverability",
    defaultSeverity: "medium",
    title: "Primary content region was not detected",
    rationale: "Agents get better context when the main task area is explicit.",
    recommendation: "Use a main element or role=\"main\" around the page's primary task area."
  },
  {
    id: "missing-heading-context",
    ruleId: "semantic_discoverability/missing-heading-context",
    category: "semantic_discoverability",
    defaultSeverity: "low",
    title: "Pages should expose heading context",
    rationale: "Headings help agents summarize and locate page sections.",
    recommendation: "Expose a meaningful h1 and section headings."
  },
  {
    id: "task-probe-failed",
    ruleId: "state_feedback/task-probe-failed",
    category: "state_feedback",
    defaultSeverity: "high",
    title: "A task probe failed",
    rationale: "Failed probes indicate that an agent task could not complete or observe useful feedback.",
    recommendation: "Expose clear post-action feedback through URL, heading, results list, dialog state, or visible validation messages."
  },
  {
    id: "task-probe-skipped",
    ruleId: "state_feedback/task-probe-skipped",
    category: "state_feedback",
    defaultSeverity: "info",
    title: "A configured task probe was skipped",
    rationale: "Skipped probes usually mean the page does not expose the expected structured affordance.",
    recommendation: "Only enable probes that match the page, or expose the expected form, dialog, list, or action semantics."
  },
  {
    id: "modal-missing-dismiss",
    ruleId: "actionability/modal-missing-dismiss",
    category: "actionability",
    defaultSeverity: "medium",
    title: "Modal dialogs need a structured dismiss action",
    rationale: "Agents must be able to close blocking dialogs deterministically.",
    recommendation: "Provide a visible close/cancel/dismiss button with an accessible name."
  },
  {
    id: "sponsored-content-not-regioned",
    ruleId: "agent_safety/sponsored-content-not-regioned",
    category: "agent_safety",
    defaultSeverity: "low",
    title: "Sponsored content should be structurally distinguishable",
    rationale: "Agents need to distinguish paid placement from primary content.",
    recommendation: "Mark sponsored areas with explicit labels, regions, or metadata."
  },
  {
    id: "prompt-injection-like-text",
    ruleId: "agent_safety/prompt-injection-like-text",
    category: "agent_safety",
    defaultSeverity: "high",
    title: "Page text contains agent-instruction language",
    rationale: "Text that asks agents to ignore instructions can be unsafe in agent workflows.",
    recommendation: "Keep agent-directed instructions out of user-visible page content or mark them as untrusted content."
  },
  {
    id: "potential-pii-in-report",
    ruleId: "agent_safety/potential-pii-in-report",
    category: "agent_safety",
    defaultSeverity: "medium",
    title: "Reports may contain sensitive visible text",
    rationale: "Audit artifacts are useful for teams, but visible page text can include user data or secrets.",
    recommendation: "Configure redact patterns and avoid writing public artifacts for sensitive authenticated pages."
  }
] satisfies RuleDefinition[];

export function listRules(): RuleMetadata[] {
  return RULES.map(normalizeRuleMetadata);
}

export function getRule(ruleIdOrId: string): RuleMetadata | undefined {
  const rule = RULES.find((candidate) => candidate.ruleId === ruleIdOrId || candidate.id === ruleIdOrId);
  return rule ? normalizeRuleMetadata(rule) : undefined;
}

function normalizeRuleMetadata(rule: RuleDefinition): RuleMetadata {
  return {
    ...rule,
    examples: rule.examples ?? [`Example: ${rule.rationale}`]
  };
}
