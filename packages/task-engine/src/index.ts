import type { BrowserDriver } from "@arb/browser-driver";
import { PlaywrightBrowserDriver } from "@arb/browser-driver";
import {
  RuntimeFailure,
  computeStateDelta,
  createLogEntry,
  normalizeRuntimeError,
  type PreviewSnapshot,
  type TaskRecord,
  type TaskStore
} from "@arb/core";
import {
  TaskSubmissionSchema,
  type StepEvidence,
  type StructuredState,
  type TaskStep,
  type TaskSubmission
} from "@arb/schemas";

export interface SubmitTaskOptions {
  async?: boolean;
}

export type BrowserDriverFactory = () => BrowserDriver;

export class TaskEngine {
  constructor(
    private readonly store: TaskStore,
    private readonly driverFactory: BrowserDriverFactory = () => new PlaywrightBrowserDriver()
  ) {}

  async submitTask(input: unknown, options: SubmitTaskOptions = { async: true }): Promise<TaskRecord> {
    const parsed = TaskSubmissionSchema.safeParse(input);
    if (!parsed.success) {
      throw new RuntimeFailure("VALIDATION_ERROR", "Task submission failed schema validation", {
        details: { issues: parsed.error.issues }
      });
    }

    const steps = planSteps(parsed.data);
    const taskId = crypto.randomUUID();
    const record = this.store.createTask({
      taskId,
      submission: parsed.data,
      totalSteps: steps.length
    });

    this.appendLog(taskId, "Task accepted", null, null, {
      taskType: parsed.data.taskType,
      totalSteps: steps.length
    });

    if (options.async === false) {
      await this.executeTask(taskId, steps);
      return this.store.getTask(taskId) ?? record;
    }

    queueMicrotask(() => {
      this.executeTask(taskId, steps).catch((error) => {
        const normalized = normalizeRuntimeError(error);
        this.store.updateTask(taskId, {
          status: "failed",
          error: normalized,
          finishedAt: new Date().toISOString()
        });
        this.appendLog(taskId, normalized.message, null, null, { code: normalized.code }, "error");
      });
    });

    return record;
  }

  private async executeTask(taskId: string, steps: TaskStep[]): Promise<void> {
    const driver = this.driverFactory();
    const extractedData: Record<string, unknown> = {};
    let state: StructuredState | null = null;
    let previewSnapshot: PreviewSnapshot | null = null;

    try {
      for (const [index, step] of steps.entries()) {
        this.store.updateTask(taskId, {
          currentStep: index + 1,
          currentStepLabel: step.action
        });
        this.appendLog(taskId, `Starting step ${index + 1}/${steps.length}: ${step.action}`, index, step.action);

        try {
          const beforeState = state;
          const beforeDriverLogCount = driver.getLogs().length;
          await this.executeStep(driver, step, extractedData);
          state = await driver.getStructuredState();
          previewSnapshot = await driver.getPreviewSnapshot();
          const evidence = createStepEvidence({
            taskId,
            step,
            index,
            beforeState,
            afterState: state,
            driverLogs: driver.getLogs().slice(beforeDriverLogCount)
          });
          this.store.updateTask(taskId, {
            completedSteps: index + 1,
            finalUrl: state.url,
            finalTitle: state.title,
            state,
            previewSnapshot,
            extractedData: { ...extractedData }
          });
          this.store.appendEvidence(taskId, evidence);
          this.appendLog(taskId, `Completed step ${index + 1}/${steps.length}: ${step.action}`, index, step.action, {
            url: state.url,
            title: state.title,
            evidenceStepId: evidence.stepId
          });
        } catch (error) {
          const normalized = normalizeRuntimeError(
            error,
            step.action === "assert" ? "ASSERTION_FAILED" : "INTERNAL_ERROR"
          );
          normalized.stepIndex = index;
          await this.captureFailureState(driver, taskId, extractedData);
          this.store.updateTask(taskId, {
            status: "failed",
            error: normalized,
            finishedAt: new Date().toISOString(),
            currentStep: index + 1,
            currentStepLabel: step.action
          });
          this.appendLog(taskId, normalized.message, index, step.action, { code: normalized.code }, "error");
          return;
        }
      }

      const finalUrl = state?.url ?? (await driver.getCurrentUrl().catch(() => null));
      const finalTitle = state?.title ?? (await driver.getTitle().catch(() => null));
      this.store.updateTask(taskId, {
        status: "success",
        finalUrl,
        finalTitle,
        state,
        previewSnapshot,
        extractedData: { ...extractedData },
        finishedAt: new Date().toISOString(),
        currentStepLabel: null
      });
      this.appendLog(taskId, "Task completed", null, null, {
        driverLogs: driver.getLogs()
      });
    } finally {
      await driver.close();
    }
  }

  private async executeStep(
    driver: BrowserDriver,
    step: TaskStep,
    extractedData: Record<string, unknown>
  ): Promise<void> {
    switch (step.action) {
      case "navigate":
        await driver.openPage(step.url, {
          waitUntil: step.waitUntil,
          timeoutMs: step.timeoutMs
        });
        return;
      case "click":
        await driver.click(step.target, step.timeoutMs);
        return;
      case "fill":
        await driver.fill(step.target, step.value, step.timeoutMs);
        return;
      case "press":
        await driver.press(step.key, step.target, step.timeoutMs);
        return;
      case "waitFor":
        await driver.waitFor(step.condition, step.timeoutMs);
        return;
      case "assert":
        await driver.assert(step.condition, step.timeoutMs);
        return;
      case "extract": {
        const key = step.extract.name ?? `${step.extract.kind}-${Object.keys(extractedData).length + 1}`;
        if (step.extract.kind === "text") {
          extractedData[key] = await driver.extractText(step.extract.target);
          return;
        }
        const state = await driver.getStructuredState();
        if (step.extract.kind === "headings") {
          extractedData[key] = state.headings;
          return;
        }
        if (step.extract.kind === "links") {
          extractedData[key] = state.links;
          return;
        }
        extractedData[key] = state;
        return;
      }
    }
  }

  private async captureFailureState(
    driver: BrowserDriver,
    taskId: string,
    extractedData: Record<string, unknown>
  ): Promise<void> {
    const [state, previewSnapshot] = await Promise.all([
      driver.getStructuredState().catch(() => null),
      driver.getPreviewSnapshot().catch(() => null)
    ]);

    this.store.updateTask(taskId, {
      state,
      previewSnapshot,
      extractedData: { ...extractedData },
      finalUrl: state?.url ?? null,
      finalTitle: state?.title ?? null
    });
  }

  private appendLog(
    taskId: string,
    message: string,
    stepIndex: number | null,
    stepAction: string | null,
    data?: Record<string, unknown>,
    level: "info" | "warn" | "error" = "info"
  ): void {
    this.store.appendLog(
      taskId,
      createLogEntry({
        taskId,
        level,
        message,
        stepIndex,
        stepAction,
        data
      })
    );
  }
}

export function planSteps(submission: TaskSubmission): TaskStep[] {
  if (submission.taskType === "workflow.execute") {
    return submission.input.steps;
  }

  const searchUrl = new URL("https://www.google.com/search");
  searchUrl.searchParams.set("q", submission.input.query);
  const firstSearchTerm = submission.input.query.split(/\s+/).find(Boolean) ?? submission.input.query;

  return [
    {
      action: "navigate",
      url: searchUrl.toString(),
      waitUntil: "domcontentloaded"
    },
    {
      action: "waitFor",
      condition: {
        kind: "text",
        value: firstSearchTerm
      },
      timeoutMs: 15000
    },
    {
      action: "extract",
      extract: {
        kind: "links",
        name: "searchResults"
      }
    }
  ];
}

function createStepEvidence(input: {
  taskId: string;
  step: TaskStep;
  index: number;
  beforeState: StructuredState | null;
  afterState: StructuredState;
  driverLogs: string[];
}): StepEvidence {
  const delta = computeStateDelta(input.taskId, input.beforeState, input.afterState);
  const observedEffects = [
    delta.urlChanged ? "url_changed" : null,
    delta.titleChanged ? "title_changed" : null,
    delta.elementsAdded.length > 0 ? `${delta.elementsAdded.length} elements_added` : null,
    delta.elementsRemoved.length > 0 ? `${delta.elementsRemoved.length} elements_removed` : null,
    delta.actionsAdded.length > 0 ? `${delta.actionsAdded.length} actions_added` : null,
    delta.actionsRemoved.length > 0 ? `${delta.actionsRemoved.length} actions_removed` : null,
    delta.majorTextChanges.length > 0 ? "text_changed" : null,
    delta.dialogChanges.length > 0 ? "dialog_changed" : null
  ].filter((value): value is string => Boolean(value));

  return {
    stepId: `${input.taskId}:step-${input.index + 1}`,
    beforeStateId: input.beforeState?.stateId ?? null,
    afterStateId: input.afterState.stateId,
    observedEffects,
    domDeltaSummary: summarizeDomDelta(delta),
    networkSummary: input.step.action === "navigate" || delta.urlChanged ? "navigation observed or expected" : "no navigation observed",
    consoleSummary: summarizeConsoleEvents(input.driverLogs),
    assertionEvidence:
      input.step.action === "assert"
        ? {
            condition: input.step.condition,
            passed: true
          }
        : null
  };
}

function summarizeDomDelta(delta: ReturnType<typeof computeStateDelta>): string {
  const parts = [
    delta.urlChanged ? "URL changed" : null,
    delta.titleChanged ? "title changed" : null,
    delta.elementsAdded.length ? `${delta.elementsAdded.length} elements added` : null,
    delta.elementsRemoved.length ? `${delta.elementsRemoved.length} elements removed` : null,
    delta.actionsAdded.length ? `${delta.actionsAdded.length} actions added` : null,
    delta.actionsRemoved.length ? `${delta.actionsRemoved.length} actions removed` : null,
    delta.majorTextChanges.length ? `${delta.majorTextChanges.length} new text summaries` : null,
    delta.dialogChanges.length ? `${delta.dialogChanges.length} dialog changes` : null
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("; ") : "no major structured state changes";
}

function summarizeConsoleEvents(driverLogs: string[]): string {
  const consoleEvents = driverLogs.filter((line) => line.includes("browser console") || line.includes("page error"));
  return consoleEvents.length > 0 ? consoleEvents.join("\n") : "no browser console events captured";
}
