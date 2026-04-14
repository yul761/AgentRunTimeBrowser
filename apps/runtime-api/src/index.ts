import { PlaywrightBrowserDriver } from "@arb/browser-driver";
import {
  InMemoryTaskStore,
  RuntimeFailure,
  computeStateDelta,
  normalizeRuntimeError,
  profileStructuredState,
  queryStructuredState,
  type TaskStore
} from "@arb/core";
import { StateObservationProfileSchema, StateQuerySchema } from "@arb/schemas";
import { TaskEngine } from "@arb/task-engine";
import cors from "cors";
import express, { type Express, type Request, type Response } from "express";

export interface RuntimeServices {
  store: TaskStore;
  engine: TaskEngine;
}

export function createRuntimeServices(): RuntimeServices {
  const store = new InMemoryTaskStore();
  const engine = new TaskEngine(store, () => new PlaywrightBrowserDriver());
  return { store, engine };
}

export function createApp(services = createRuntimeServices()): Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "agentability-audit-runtime",
      positioning:
        "Agentability Audit uses this browser runtime engine to run deterministic probes and collect structured evidence.",
      timestamp: new Date().toISOString()
    });
  });

  app.get("/capabilities", (_req, res) => {
    res.json({
      structuredState: {
        supported: true,
        profiles: ["minimal", "interactive_only", "form_mode", "navigation_mode", "full"]
      },
      actionGraph: { supported: true },
      stateDelta: { supported: true },
      preview: { supported: true, mode: "snapshot" },
      download: { supported: false },
      frame: { supported: false, supportLevel: "not_exposed_in_mvp" },
      shadowDom: { supported: true, supportLevel: "best_effort_open_shadow_dom_via_dom_selectors" },
      canvasSemantic: { supported: false, supportLevel: "not_supported_without_app_semantics" }
    });
  });

  app.post("/tasks", async (req, res) => {
    try {
      const task = await services.engine.submitTask(req.body);
      res.status(202).json(task);
    } catch (error) {
      sendRuntimeError(res, error);
    }
  });

  app.get("/tasks", (_req, res) => {
    res.json(
      services.store.listTasks().map((task) => ({
        taskId: task.taskId,
        taskType: task.taskType,
        status: task.status,
        currentStep: task.currentStep,
        currentStepLabel: task.currentStepLabel,
        completedSteps: task.completedSteps,
        totalSteps: task.totalSteps,
        finalUrl: task.finalUrl,
        finalTitle: task.finalTitle,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt,
        error: task.error
      }))
    );
  });

  app.get("/tasks/:id", (req, res) => {
    const task = getTaskOr404(services.store, req, res);
    if (!task) {
      return;
    }
    res.json(task);
  });

  app.get("/tasks/:id/state", (req, res) => {
    const task = getTaskOr404(services.store, req, res);
    if (!task) {
      return;
    }
    const parsedProfile = StateObservationProfileSchema.safeParse(req.query.profile ?? "full");
    if (!parsedProfile.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid state observation profile",
          details: { profiles: ["minimal", "interactive_only", "form_mode", "navigation_mode", "full"] },
          timestamp: new Date().toISOString()
        }
      });
      return;
    }
    res.json({
      taskId: task.taskId,
      profile: parsedProfile.data,
      state: profileStructuredState(task.state, parsedProfile.data)
    });
  });

  app.get("/tasks/:id/state-delta", (req, res) => {
    const task = getTaskOr404(services.store, req, res);
    if (!task) {
      return;
    }
    const since = typeof req.query.since === "string" ? req.query.since : null;
    const fromState = since
      ? task.stateHistory.find((state) => state.stateId === since) ?? null
      : task.stateHistory.at(-2) ?? null;
    res.json(computeStateDelta(task.taskId, fromState, task.state));
  });

  app.get("/tasks/:id/state/stream", (req, res) => {
    const task = getTaskOr404(services.store, req, res);
    if (!task) {
      return;
    }
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("connection", "keep-alive");
    res.write(`event: state\n`);
    res.write(`data: ${JSON.stringify({ taskId: task.taskId, state: task.state })}\n\n`);
    const unsubscribe = services.store.subscribeStateChanges(task.taskId, (state) => {
      res.write(`event: state\n`);
      res.write(`data: ${JSON.stringify({ taskId: task.taskId, state })}\n\n`);
    });
    req.on("close", unsubscribe);
  });

  app.get("/tasks/:id/logs", (req, res) => {
    const task = getTaskOr404(services.store, req, res);
    if (!task) {
      return;
    }
    res.json({
      taskId: task.taskId,
      logs: task.logs
    });
  });

  app.get("/tasks/:id/evidence", (req, res) => {
    const task = getTaskOr404(services.store, req, res);
    if (!task) {
      return;
    }
    res.json({
      taskId: task.taskId,
      evidence: task.evidence
    });
  });

  app.post("/state/query", (req, res) => {
    const parsed = StateQuerySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid state query",
          details: { issues: parsed.error.issues },
          timestamp: new Date().toISOString()
        }
      });
      return;
    }
    const task = parsed.data.taskId
      ? services.store.getTask(parsed.data.taskId)
      : services.store.listTasks().find((record) => record.state);
    if (!task) {
      res.status(404).json({
        error: {
          code: "TARGET_NOT_FOUND",
          message: "No task with structured state was found for this query",
          timestamp: new Date().toISOString()
        }
      });
      return;
    }
    res.json({
      taskId: task.taskId,
      query: parsed.data,
      state: queryStructuredState(task.state, parsed.data)
    });
  });

  app.get("/tasks/:id/snapshot", (req, res) => {
    const task = getTaskOr404(services.store, req, res);
    if (!task) {
      return;
    }
    if (!task.previewSnapshot) {
      res.status(404).json({
        error: {
          code: "TARGET_NOT_FOUND",
          message: "No preview snapshot has been captured for this task",
          timestamp: new Date().toISOString()
        }
      });
      return;
    }
    res.json(task.previewSnapshot);
  });

  return app;
}

export async function startServer(port = Number(process.env.ARB_PORT ?? 8787)) {
  const app = createApp();
  return app.listen(port, () => {
    console.log(`Agentability Audit runtime inspection API listening on http://localhost:${port}`);
    console.log("Run audits with `arb audit`; POST lower-level structured tasks to /tasks when debugging probes.");
    console.log("Probe monitor UI defaults to http://localhost:5173");
  });
}

function getTaskOr404(store: TaskStore, req: Request, res: Response) {
  const taskId = String(req.params.id);
  const task = store.getTask(taskId);
  if (!task) {
    res.status(404).json({
      error: {
        code: "TARGET_NOT_FOUND",
        message: `Task not found: ${taskId}`,
        timestamp: new Date().toISOString()
      }
    });
    return undefined;
  }
  return task;
}

function sendRuntimeError(res: Response, error: unknown) {
  const normalized = normalizeRuntimeError(error);
  const status = error instanceof RuntimeFailure && error.code === "VALIDATION_ERROR" ? 400 : 500;
  res.status(status).json({ error: normalized });
}

if (process.env.NODE_ENV !== "test") {
  startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
