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

export const TaskSubmissionSchema = z.discriminatedUnion("taskType", [
  z.object({
    taskType: z.literal("workflow.execute"),
    input: z.object({
      steps: z.array(TaskStepSchema).min(1)
    })
  }),
  z.object({
    taskType: z.literal("web.search"),
    input: z.object({
      engine: z.literal("google"),
      query: z.string().min(1)
    })
  })
]);

export const StructuredElementSchema = z.object({
  id: z.string(),
  role: z.string().optional(),
  name: z.string()
});

export const StructuredInputSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.string().optional()
});

export const StructuredLinkSchema = z.object({
  id: z.string(),
  name: z.string(),
  href: z.string().optional()
});

export const StructuredHeadingSchema = z.object({
  level: z.number().int().min(1).max(6),
  text: z.string()
});

export const StructuredFormSchema = z.object({
  id: z.string(),
  name: z.string()
});

export const AvailableActionSchema = z.object({
  id: z.string(),
  action: z.enum(["click", "fill", "press", "navigate"]),
  target: TargetSchema.optional(),
  description: z.string()
});

export const StructuredStateSchema = z.object({
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
  timestamp: z.string()
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
export type TaskSubmission = z.infer<typeof TaskSubmissionSchema>;
export type StructuredState = z.infer<typeof StructuredStateSchema>;
export type LogEntry = z.infer<typeof LogEntrySchema>;
export type TaskResult = z.infer<typeof TaskResultSchema>;
