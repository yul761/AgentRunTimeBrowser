import type {
  LogEntry,
  RuntimeError,
  RuntimeErrorCode,
  StructuredState,
  TaskResult,
  TaskSubmission
} from "@arb/schemas";

export interface PreviewSnapshot {
  mimeType: "image/png";
  dataBase64: string;
  capturedAt: string;
}

export interface TaskRecord extends TaskResult {
  taskType: TaskSubmission["taskType"];
  submission: TaskSubmission;
  currentStep: number;
  currentStepLabel: string | null;
  previewSnapshot: PreviewSnapshot | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  taskId: string;
  submission: TaskSubmission;
  totalSteps: number;
}

export interface TaskStore {
  createTask(input: CreateTaskInput): TaskRecord;
  listTasks(): TaskRecord[];
  getTask(taskId: string): TaskRecord | undefined;
  updateTask(taskId: string, patch: Partial<TaskRecord>): TaskRecord | undefined;
  appendLog(taskId: string, log: LogEntry): TaskRecord | undefined;
}

export class InMemoryTaskStore implements TaskStore {
  private readonly tasks = new Map<string, TaskRecord>();

  createTask(input: CreateTaskInput): TaskRecord {
    const now = new Date().toISOString();
    const record: TaskRecord = {
      taskId: input.taskId,
      taskType: input.submission.taskType,
      submission: input.submission,
      status: "running",
      completedSteps: 0,
      totalSteps: input.totalSteps,
      finalUrl: null,
      finalTitle: null,
      state: null,
      extractedData: {},
      logs: [],
      startedAt: now,
      finishedAt: null,
      error: null,
      currentStep: 0,
      currentStepLabel: null,
      previewSnapshot: null,
      createdAt: now,
      updatedAt: now
    };
    this.tasks.set(record.taskId, record);
    return record;
  }

  listTasks(): TaskRecord[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getTask(taskId: string): TaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  updateTask(taskId: string, patch: Partial<TaskRecord>): TaskRecord | undefined {
    const existing = this.tasks.get(taskId);
    if (!existing) {
      return undefined;
    }
    const updated: TaskRecord = {
      ...existing,
      ...patch,
      logs: patch.logs ?? existing.logs,
      extractedData: patch.extractedData ?? existing.extractedData,
      updatedAt: new Date().toISOString()
    };
    this.tasks.set(taskId, updated);
    return updated;
  }

  appendLog(taskId: string, log: LogEntry): TaskRecord | undefined {
    const existing = this.tasks.get(taskId);
    if (!existing) {
      return undefined;
    }
    return this.updateTask(taskId, {
      logs: [...existing.logs, log]
    });
  }
}

export class RuntimeFailure extends Error {
  readonly code: RuntimeErrorCode;
  readonly details?: Record<string, unknown>;
  readonly stepIndex?: number | null;

  constructor(
    code: RuntimeErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; stepIndex?: number | null; cause?: unknown } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "RuntimeFailure";
    this.code = code;
    this.details = options.details;
    this.stepIndex = options.stepIndex;
  }
}

export function normalizeRuntimeError(error: unknown, fallbackCode: RuntimeErrorCode = "INTERNAL_ERROR"): RuntimeError {
  if (error instanceof RuntimeFailure) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
      stepIndex: error.stepIndex ?? null,
      timestamp: new Date().toISOString()
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  const code = classifyErrorMessage(message, fallbackCode);
  return {
    code,
    message,
    stepIndex: null,
    timestamp: new Date().toISOString()
  };
}

export function classifyErrorMessage(message: string, fallbackCode: RuntimeErrorCode = "INTERNAL_ERROR"): RuntimeErrorCode {
  const normalized = message.toLowerCase();
  if (normalized.includes("timeout")) {
    return "ACTION_TIMEOUT";
  }
  if (normalized.includes("navigation") || normalized.includes("net::")) {
    return "NAVIGATION_FAILED";
  }
  if (normalized.includes("not found") || normalized.includes("locator")) {
    return "TARGET_NOT_FOUND";
  }
  if (normalized.includes("assert")) {
    return "ASSERTION_FAILED";
  }
  return fallbackCode;
}

export function createLogEntry(input: {
  taskId: string;
  level?: LogEntry["level"];
  message: string;
  stepIndex?: number | null;
  stepAction?: string | null;
  data?: Record<string, unknown>;
}): LogEntry {
  return {
    id: crypto.randomUUID(),
    taskId: input.taskId,
    level: input.level ?? "info",
    message: input.message,
    stepIndex: input.stepIndex ?? null,
    stepAction: input.stepAction ?? null,
    timestamp: new Date().toISOString(),
    data: input.data
  };
}

export function emptyStructuredState(sessionId: string, pageId: string): StructuredState {
  return {
    sessionId,
    pageId,
    url: "",
    title: "",
    buttons: [],
    inputs: [],
    links: [],
    headings: [],
    forms: [],
    visibleTextSummary: [],
    availableActions: [],
    timestamp: new Date().toISOString()
  };
}
