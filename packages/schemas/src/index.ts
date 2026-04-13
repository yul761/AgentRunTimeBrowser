import { z } from "zod";

export const RuntimeErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "TARGET_NOT_FOUND",
  "ACTION_TIMEOUT",
  "NAVIGATION_FAILED",
  "ASSERTION_FAILED",
  "INTERNAL_ERROR"
]);

export const RuntimeErrorSchema = z.object({
  code: RuntimeErrorCodeSchema,
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  stepIndex: z.number().int().nonnegative().nullable().optional(),
  timestamp: z.string()
});

export const TargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("role"),
    role: z.string().min(1),
    name: z.string().min(1).optional(),
    exact: z.boolean().optional()
  }),
  z.object({
    kind: z.literal("label"),
    value: z.string().min(1),
    exact: z.boolean().optional()
  }),
  z.object({
    kind: z.literal("text"),
    value: z.string().min(1),
    exact: z.boolean().optional()
  }),
  z.object({
    kind: z.literal("testId"),
    value: z.string().min(1)
  }),
  z.object({
    kind: z.literal("css"),
    selector: z.string().min(1),
    internal: z.boolean().optional()
  })
]);

export const WaitConditionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    value: z.string().min(1),
    exact: z.boolean().optional()
  }),
  z.object({
    kind: z.literal("urlIncludes"),
    value: z.string().min(1)
  }),
  z.object({
    kind: z.literal("titleIncludes"),
    value: z.string().min(1)
  }),
  z.object({
    kind: z.literal("targetVisible"),
    target: TargetSchema
  }),
  z.object({
    kind: z.literal("loadState"),
    state: z.enum(["load", "domcontentloaded", "networkidle"]).default("domcontentloaded")
  }),
  z.object({
    kind: z.literal("timeout"),
    ms: z.number().int().positive().max(30000)
  })
]);

export const ExtractSpecSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    target: TargetSchema.optional(),
    name: z.string().min(1).optional()
  }),
  z.object({
    kind: z.literal("headings"),
    name: z.string().min(1).optional()
  }),
  z.object({
    kind: z.literal("links"),
    name: z.string().min(1).optional()
  }),
  z.object({
    kind: z.literal("state"),
    name: z.string().min(1).optional()
  })
]);

export const AssertConditionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    value: z.string().min(1),
    exact: z.boolean().optional()
  }),
  z.object({
    kind: z.literal("urlIncludes"),
    value: z.string().min(1)
  }),
  z.object({
    kind: z.literal("titleIncludes"),
    value: z.string().min(1)
  }),
  z.object({
    kind: z.literal("targetVisible"),
    target: TargetSchema
  })
]);

export const TaskStepSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("navigate"),
    url: z.string().url(),
    waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).default("domcontentloaded").optional(),
    timeoutMs: z.number().int().positive().max(120000).optional()
  }),
  z.object({
    action: z.literal("click"),
    target: TargetSchema,
    timeoutMs: z.number().int().positive().max(120000).optional()
  }),
  z.object({
    action: z.literal("fill"),
    target: TargetSchema,
    value: z.string(),
    timeoutMs: z.number().int().positive().max(120000).optional()
  }),
  z.object({
    action: z.literal("press"),
    key: z.string().min(1),
    target: TargetSchema.optional(),
    timeoutMs: z.number().int().positive().max(120000).optional()
  }),
  z.object({
    action: z.literal("waitFor"),
    condition: WaitConditionSchema,
    timeoutMs: z.number().int().positive().max(120000).optional()
  }),
  z.object({
    action: z.literal("extract"),
    extract: ExtractSpecSchema
  }),
  z.object({
    action: z.literal("assert"),
    condition: AssertConditionSchema,
    timeoutMs: z.number().int().positive().max(120000).optional()
  })
]);

export const StateObservationProfileSchema = z.enum([
  "minimal",
  "interactive_only",
  "form_mode",
  "navigation_mode",
  "full"
]);

export const TaskRuntimeOptionsSchema = z.object({
  capturePreview: z.boolean().optional(),
  captureEvidence: z.boolean().optional(),
  observationProfile: StateObservationProfileSchema.optional()
});

export const TaskSubmissionSchema = z.discriminatedUnion("taskType", [
  z.object({
    taskType: z.literal("workflow.execute"),
    runtime: TaskRuntimeOptionsSchema.optional(),
    input: z.object({
      steps: z.array(TaskStepSchema).min(1)
    })
  }),
  z.object({
    taskType: z.literal("web.search"),
    runtime: TaskRuntimeOptionsSchema.optional(),
    input: z.object({
      engine: z.literal("google"),
      query: z.string().min(1)
    })
  })
]);

export const SemanticIdentitySchema = z.object({
  elementInstanceId: z.string(),
  semanticElementId: z.string(),
  locatorFingerprint: z.string(),
  lineage: z.array(z.string())
});

export const StructuredElementSchema = SemanticIdentitySchema.extend({
  id: z.string(),
  role: z.string().optional(),
  name: z.string()
});

export const StructuredInputSchema = SemanticIdentitySchema.extend({
  id: z.string(),
  label: z.string(),
  type: z.string().optional()
});

export const StructuredLinkSchema = SemanticIdentitySchema.extend({
  id: z.string(),
  name: z.string(),
  href: z.string().optional()
});

export const StructuredHeadingSchema = SemanticIdentitySchema.extend({
  id: z.string(),
  level: z.number().int().min(1).max(6),
  text: z.string()
});

export const StructuredFormSchema = SemanticIdentitySchema.extend({
  id: z.string(),
  name: z.string()
});

export const AvailableActionSchema = z.object({
  id: z.string(),
  action: z.enum(["click", "fill", "press", "navigate"]),
  target: TargetSchema.optional(),
  description: z.string()
});

export const ActionGraphActionSchema = z.object({
  actionId: z.string(),
  kind: z.enum([
    "click",
    "submit_form",
    "navigate",
    "open_link",
    "toggle",
    "focus",
    "download",
    "dismiss_dialog"
  ]),
  label: z.string().optional(),
  targetElementId: z.string().optional(),
  preconditions: z.array(z.string()).optional(),
  effects: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional()
});

export const ActionGraphSchema = z.object({
  actions: z.array(ActionGraphActionSchema)
});

export const IntentRegionSchema = z.object({
  regionId: z.string(),
  kind: z.enum([
    "search_interface",
    "auth_form",
    "results_list",
    "navigation_bar",
    "modal_dialog",
    "primary_content",
    "secondary_content"
  ]),
  title: z.string().optional(),
  primaryActions: z.array(z.string()),
  elements: z.array(z.string())
});

export const StructuredStateSchema = z.object({
  stateId: z.string(),
  sessionId: z.string(),
  pageId: z.string(),
  url: z.string(),
  title: z.string(),
  buttons: z.array(StructuredElementSchema),
  inputs: z.array(StructuredInputSchema),
  links: z.array(StructuredLinkSchema),
  headings: z.array(StructuredHeadingSchema),
  forms: z.array(StructuredFormSchema),
  visibleTextSummary: z.array(z.string()),
  availableActions: z.array(AvailableActionSchema),
  actionGraph: ActionGraphSchema,
  regions: z.array(IntentRegionSchema),
  timestamp: z.string()
});

export const StateDeltaSchema = z.object({
  taskId: z.string(),
  fromStateId: z.string().nullable(),
  toStateId: z.string().nullable(),
  urlChanged: z.boolean(),
  titleChanged: z.boolean(),
  elementsAdded: z.array(SemanticIdentitySchema.extend({ id: z.string(), label: z.string().optional() })),
  elementsRemoved: z.array(SemanticIdentitySchema.extend({ id: z.string(), label: z.string().optional() })),
  actionsAdded: z.array(ActionGraphActionSchema),
  actionsRemoved: z.array(ActionGraphActionSchema),
  majorTextChanges: z.array(z.string()),
  dialogChanges: z.array(z.string()),
  timestamp: z.string()
});

export const StateQuerySchema = z.object({
  taskId: z.string().optional(),
  taskHint: z.string().min(1).optional(),
  include: z.array(z.string()).default([]).optional(),
  exclude: z.array(z.string()).default([]).optional(),
  profile: StateObservationProfileSchema.default("full").optional()
});

export const StepEvidenceSchema = z.object({
  stepId: z.string(),
  beforeStateId: z.string().nullable(),
  afterStateId: z.string().nullable(),
  observedEffects: z.array(z.string()),
  domDeltaSummary: z.string(),
  networkSummary: z.string(),
  consoleSummary: z.string(),
  assertionEvidence: z.record(z.unknown()).nullable()
});

export const AuditIssueSchema = z.object({
  id: z.string(),
  severity: z.enum(["info", "low", "medium", "high"]),
  category: z.enum([
    "semantic_discoverability",
    "actionability",
    "state_feedback",
    "recoverability",
    "agent_safety"
  ]),
  title: z.string(),
  message: z.string(),
  evidence: z.record(z.unknown()).optional(),
  recommendation: z.string().optional()
});

export const AuditScoresSchema = z.object({
  overall: z.number().int().min(0).max(100),
  semanticDiscoverability: z.number().int().min(0).max(100),
  actionability: z.number().int().min(0).max(100),
  stateFeedback: z.number().int().min(0).max(100),
  recoverability: z.number().int().min(0).max(100),
  agentSafety: z.number().int().min(0).max(100)
});

export const AuditTaskProbeSchema = z.object({
  task: z.enum(["page", "search"]),
  status: z.enum(["passed", "failed", "skipped"]),
  steps: z.number().int().nonnegative(),
  observedEffects: z.array(z.string()),
  error: z.string().nullable(),
  evidence: z.record(z.unknown()).optional()
});

export const AuditReportSchema = z.object({
  reportId: z.string(),
  url: z.string(),
  finalUrl: z.string(),
  title: z.string(),
  generatedAt: z.string(),
  scores: AuditScoresSchema,
  issues: z.array(AuditIssueSchema),
  taskProbes: z.array(AuditTaskProbeSchema),
  state: StructuredStateSchema
});

export const CapabilitiesSchema = z.object({
  structuredState: z.object({ supported: z.boolean(), profiles: z.array(StateObservationProfileSchema) }),
  actionGraph: z.object({ supported: z.boolean() }),
  stateDelta: z.object({ supported: z.boolean() }),
  preview: z.object({ supported: z.boolean(), mode: z.literal("snapshot") }),
  download: z.object({ supported: z.boolean() }),
  frame: z.object({ supported: z.boolean(), supportLevel: z.string() }),
  shadowDom: z.object({ supported: z.boolean(), supportLevel: z.string() }),
  canvasSemantic: z.object({ supported: z.boolean(), supportLevel: z.string() })
});

export const LogEntrySchema = z.object({
  id: z.string(),
  taskId: z.string(),
  level: z.enum(["info", "warn", "error"]),
  message: z.string(),
  stepIndex: z.number().int().nonnegative().nullable(),
  stepAction: z.string().nullable(),
  timestamp: z.string(),
  data: z.record(z.unknown()).optional()
});

export const TaskResultSchema = z.object({
  taskId: z.string(),
  status: z.enum(["success", "failed", "running"]),
  completedSteps: z.number().int().nonnegative(),
  totalSteps: z.number().int().nonnegative(),
  finalUrl: z.string().nullable(),
  finalTitle: z.string().nullable(),
  state: StructuredStateSchema.nullable(),
  extractedData: z.record(z.unknown()),
  logs: z.array(LogEntrySchema),
  evidence: z.array(StepEvidenceSchema),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  error: RuntimeErrorSchema.nullable()
});

export type RuntimeErrorCode = z.infer<typeof RuntimeErrorCodeSchema>;
export type RuntimeError = z.infer<typeof RuntimeErrorSchema>;
export type Target = z.infer<typeof TargetSchema>;
export type WaitCondition = z.infer<typeof WaitConditionSchema>;
export type ExtractSpec = z.infer<typeof ExtractSpecSchema>;
export type AssertCondition = z.infer<typeof AssertConditionSchema>;
export type TaskStep = z.infer<typeof TaskStepSchema>;
export type TaskRuntimeOptions = z.infer<typeof TaskRuntimeOptionsSchema>;
export type TaskSubmission = z.infer<typeof TaskSubmissionSchema>;
export type StateObservationProfile = z.infer<typeof StateObservationProfileSchema>;
export type StructuredState = z.infer<typeof StructuredStateSchema>;
export type StateDelta = z.infer<typeof StateDeltaSchema>;
export type StateQuery = z.infer<typeof StateQuerySchema>;
export type StepEvidence = z.infer<typeof StepEvidenceSchema>;
export type AuditIssue = z.infer<typeof AuditIssueSchema>;
export type AuditScores = z.infer<typeof AuditScoresSchema>;
export type AuditTaskProbe = z.infer<typeof AuditTaskProbeSchema>;
export type AuditReport = z.infer<typeof AuditReportSchema>;
export type Capabilities = z.infer<typeof CapabilitiesSchema>;
export type LogEntry = z.infer<typeof LogEntrySchema>;
export type TaskResult = z.infer<typeof TaskResultSchema>;
