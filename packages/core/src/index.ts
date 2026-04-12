import type {
  LogEntry,
  RuntimeError,
  RuntimeErrorCode,
  StateDelta,
  StateObservationProfile,
  StateQuery,
  StepEvidence,
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
  stateHistory: StructuredState[];
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
  appendEvidence(taskId: string, evidence: StepEvidence): TaskRecord | undefined;
  subscribeStateChanges(taskId: string, listener: (state: StructuredState) => void): () => void;
}

export class InMemoryTaskStore implements TaskStore {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly stateListeners = new Map<string, Set<(state: StructuredState) => void>>();

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
      evidence: [],
      startedAt: now,
      finishedAt: null,
      error: null,
      currentStep: 0,
      currentStepLabel: null,
      previewSnapshot: null,
      stateHistory: [],
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
    const stateHistory =
      patch.state && patch.state.stateId !== existing.state?.stateId
        ? [...existing.stateHistory, patch.state].slice(-50)
        : patch.stateHistory ?? existing.stateHistory;
    const updated: TaskRecord = {
      ...existing,
      ...patch,
      logs: patch.logs ?? existing.logs,
      evidence: patch.evidence ?? existing.evidence,
      extractedData: patch.extractedData ?? existing.extractedData,
      stateHistory,
      updatedAt: new Date().toISOString()
    };
    this.tasks.set(taskId, updated);
    if (patch.state && patch.state.stateId !== existing.state?.stateId) {
      this.notifyStateListeners(taskId, patch.state);
    }
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

  appendEvidence(taskId: string, evidence: StepEvidence): TaskRecord | undefined {
    const existing = this.tasks.get(taskId);
    if (!existing) {
      return undefined;
    }
    return this.updateTask(taskId, {
      evidence: [...existing.evidence, evidence]
    });
  }

  subscribeStateChanges(taskId: string, listener: (state: StructuredState) => void): () => void {
    const listeners = this.stateListeners.get(taskId) ?? new Set<(state: StructuredState) => void>();
    listeners.add(listener);
    this.stateListeners.set(taskId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.stateListeners.delete(taskId);
      }
    };
  }

  private notifyStateListeners(taskId: string, state: StructuredState): void {
    for (const listener of this.stateListeners.get(taskId) ?? []) {
      listener(state);
    }
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
  const now = new Date().toISOString();
  return {
    stateId: crypto.randomUUID(),
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
    actionGraph: { actions: [] },
    regions: [],
    timestamp: now
  };
}

export function computeStateDelta(
  taskId: string,
  fromState: StructuredState | null,
  toState: StructuredState | null
): StateDelta {
  const fromElements = flattenElements(fromState);
  const toElements = flattenElements(toState);
  const fromElementIds = new Set(fromElements.map((element) => element.semanticElementId));
  const toElementIds = new Set(toElements.map((element) => element.semanticElementId));
  const fromActions = fromState?.actionGraph.actions ?? [];
  const toActions = toState?.actionGraph.actions ?? [];
  const fromActionIds = new Set(fromActions.map((action) => action.actionId));
  const toActionIds = new Set(toActions.map((action) => action.actionId));

  return {
    taskId,
    fromStateId: fromState?.stateId ?? null,
    toStateId: toState?.stateId ?? null,
    urlChanged: (fromState?.url ?? null) !== (toState?.url ?? null),
    titleChanged: (fromState?.title ?? null) !== (toState?.title ?? null),
    elementsAdded: toElements.filter((element) => !fromElementIds.has(element.semanticElementId)),
    elementsRemoved: fromElements.filter((element) => !toElementIds.has(element.semanticElementId)),
    actionsAdded: toActions.filter((action) => !fromActionIds.has(action.actionId)),
    actionsRemoved: fromActions.filter((action) => !toActionIds.has(action.actionId)),
    majorTextChanges: computeTextChanges(fromState, toState),
    dialogChanges: computeDialogChanges(fromState, toState),
    timestamp: new Date().toISOString()
  };
}

export function profileStructuredState(
  state: StructuredState | null,
  profile: StateObservationProfile = "full"
): StructuredState | null {
  if (!state || profile === "full") {
    return state;
  }

  if (profile === "minimal") {
    return {
      ...state,
      buttons: [],
      inputs: [],
      links: [],
      headings: state.headings.slice(0, 3),
      forms: [],
      visibleTextSummary: state.visibleTextSummary.slice(0, 4),
      availableActions: [],
      actionGraph: { actions: state.actionGraph.actions.slice(0, 8) },
      regions: state.regions.filter((region) => region.kind === "primary_content").slice(0, 1)
    };
  }

  if (profile === "interactive_only") {
    return {
      ...state,
      headings: [],
      visibleTextSummary: [],
      actionGraph: { actions: state.actionGraph.actions },
      regions: state.regions.filter((region) => region.primaryActions.length > 0)
    };
  }

  if (profile === "form_mode") {
    const formElementIds = new Set(
      state.regions
        .filter((region) => region.kind === "auth_form" || region.kind === "search_interface")
        .flatMap((region) => region.elements)
    );
    return {
      ...state,
      links: [],
      headings: state.headings.slice(0, 3),
      inputs: state.inputs,
      buttons: state.buttons,
      forms: state.forms,
      visibleTextSummary: state.visibleTextSummary.filter((line) => /error|required|invalid|password|email|search/i.test(line)),
      actionGraph: {
        actions: state.actionGraph.actions.filter(
          (action) =>
            action.kind === "submit_form" ||
            action.kind === "focus" ||
            (action.targetElementId ? formElementIds.has(action.targetElementId) : false)
        )
      },
      regions: state.regions.filter((region) => region.kind === "auth_form" || region.kind === "search_interface")
    };
  }

  return {
    ...state,
    buttons: [],
    inputs: [],
    forms: [],
    visibleTextSummary: state.visibleTextSummary.slice(0, 6),
    actionGraph: {
      actions: state.actionGraph.actions.filter((action) => action.kind === "navigate" || action.kind === "open_link")
    },
    regions: state.regions.filter((region) => region.kind === "navigation_bar" || region.kind === "results_list")
  };
}

export function queryStructuredState(state: StructuredState | null, query: StateQuery): StructuredState | null {
  const profiled = profileStructuredState(state, query.profile ?? "full");
  if (!profiled) {
    return null;
  }

  const include = new Set((query.include ?? []).map((item) => item.toLowerCase()));
  const exclude = new Set((query.exclude ?? []).map((item) => item.toLowerCase()));
  const hint = query.taskHint?.toLowerCase() ?? "";
  let next = profiled;

  if (hint.includes("login") || hint.includes("auth")) {
    next = profileStructuredState(next, "form_mode") ?? next;
  }
  if (hint.includes("navigate") || hint.includes("link")) {
    next = profileStructuredState(next, "navigation_mode") ?? next;
  }

  const wants = (key: string) => include.size === 0 || include.has(key);
  next = {
    ...next,
    buttons: wants("buttons") ? next.buttons : [],
    inputs: wants("forms") || wants("inputs") || wants("errors") ? next.inputs : [],
    forms: wants("forms") ? next.forms : [],
    links: wants("navigation") || wants("links") ? next.links : [],
    visibleTextSummary: next.visibleTextSummary.filter((line) => {
      const lower = line.toLowerCase();
      if (exclude.has("footer") && lower.includes("footer")) return false;
      if (exclude.has("ads") && /\bad\b|advertis/i.test(lower)) return false;
      if (exclude.has("decorative") && lower.length < 3) return false;
      return include.has("errors") ? /error|required|invalid|failed/i.test(lower) : true;
    }),
    regions: next.regions.filter((region) => {
      if (exclude.has("footer") && region.kind === "secondary_content") return false;
      return true;
    })
  };
  return next;
}

function flattenElements(state: StructuredState | null) {
  if (!state) {
    return [];
  }
  return [
    ...state.buttons.map((element) => ({ ...element, label: element.name })),
    ...state.inputs.map((element) => ({ ...element, label: element.label })),
    ...state.links.map((element) => ({ ...element, label: element.name })),
    ...state.headings.map((element) => ({ ...element, label: element.text })),
    ...state.forms.map((element) => ({ ...element, label: element.name }))
  ];
}

function computeTextChanges(fromState: StructuredState | null, toState: StructuredState | null): string[] {
  const fromText = new Set(fromState?.visibleTextSummary ?? []);
  return (toState?.visibleTextSummary ?? []).filter((line) => !fromText.has(line)).slice(0, 12);
}

function computeDialogChanges(fromState: StructuredState | null, toState: StructuredState | null): string[] {
  const fromDialogs = new Set(fromState?.regions.filter((region) => region.kind === "modal_dialog").map((region) => region.regionId) ?? []);
  return (
    toState?.regions
      .filter((region) => region.kind === "modal_dialog" && !fromDialogs.has(region.regionId))
      .map((region) => region.title ?? region.regionId) ?? []
  );
}
