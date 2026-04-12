import { PlaywrightBrowserDriver } from "@arb/browser-driver";
import { InMemoryTaskStore, RuntimeFailure, normalizeRuntimeError, type TaskStore } from "@arb/core";
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
      service: "agent-runtime-browser",
      positioning:
        "Agent Runtime Browser is a structured browser execution environment for agents.",
      timestamp: new Date().toISOString()
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
    res.json({
      taskId: task.taskId,
      state: task.state
    });
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
    console.log(`Agent Runtime Browser API listening on http://localhost:${port}`);
    console.log("POST structured tasks to /tasks; monitor UI defaults to http://localhost:5173");
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
