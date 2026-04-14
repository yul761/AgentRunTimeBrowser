import { useEffect, useMemo, useState } from "react";

const apiUrl = (import.meta.env.VITE_RUNTIME_API_URL ?? "http://localhost:8787").replace(/\/$/, "");

interface TaskSummary {
  taskId: string;
  taskType: string;
  status: "running" | "success" | "failed";
  currentStep: number;
  currentStepLabel: string | null;
  completedSteps: number;
  totalSteps: number;
  finalUrl: string | null;
  finalTitle: string | null;
  startedAt: string;
  finishedAt: string | null;
  error: { code: string; message: string } | null;
}

interface TaskDetail extends TaskSummary {
  state: unknown;
  extractedData: Record<string, unknown>;
  logs: Array<{
    id: string;
    level: string;
    message: string;
    stepIndex: number | null;
    timestamp: string;
    data?: Record<string, unknown>;
  }>;
}

interface PreviewSnapshot {
  mimeType: string;
  dataBase64: string;
  capturedAt: string;
}

export function App() {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [snapshot, setSnapshot] = useState<PreviewSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const refresh = async () => {
      try {
        const nextTasks = await getJson<TaskSummary[]>("/tasks");
        setTasks(nextTasks);
        setError(null);
        if (!selectedTaskId && nextTasks[0]) {
          setSelectedTaskId(nextTasks[0].taskId);
        }
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : String(requestError));
      }
    };

    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, [selectedTaskId]);

  useEffect(() => {
    if (!selectedTaskId) {
      setDetail(null);
      setSnapshot(null);
      return;
    }

    const refresh = async () => {
      try {
        const nextDetail = await getJson<TaskDetail>(`/tasks/${selectedTaskId}`);
        setDetail(nextDetail);
        const nextSnapshot = await getJson<PreviewSnapshot>(`/tasks/${selectedTaskId}/snapshot`).catch(() => null);
        setSnapshot(nextSnapshot);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : String(requestError));
      }
    };

    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, [selectedTaskId]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.taskId === selectedTaskId) ?? null,
    [selectedTaskId, tasks]
  );

  return (
    <main className="shell">
      <aside className="task-list" aria-label="Tasks">
        <div className="topline">
          <h1>Agentability Probe Monitor</h1>
          <span>{tasks.length} probes</span>
        </div>
        {error ? <p className="error">{error}</p> : null}
        <div className="tasks">
          {tasks.length === 0 ? <p className="muted">No probe tasks submitted.</p> : null}
          {tasks.map((task) => (
            <button
              className={`task-row ${task.taskId === selectedTaskId ? "selected" : ""}`}
              key={task.taskId}
              onClick={() => setSelectedTaskId(task.taskId)}
            >
              <span className={`status-dot ${task.status}`} />
              <span>
                <strong>{task.taskType}</strong>
                <small>{task.taskId}</small>
              </span>
              <span className="step-count">
                {task.completedSteps}/{task.totalSteps}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="detail" aria-label="Task detail">
        {!selectedTask ? (
          <div className="empty">Run an audit probe or submit a structured runtime task to begin.</div>
        ) : (
          <>
            <header className="detail-header">
              <div>
                <p className="eyebrow">{selectedTask.taskId}</p>
                <h2>{selectedTask.taskType}</h2>
              </div>
              <StatusBadge status={selectedTask.status} />
            </header>

            <section className="metrics" aria-label="Task status">
              <Metric label="Progress" value={`${selectedTask.completedSteps}/${selectedTask.totalSteps}`} />
              <Metric label="Current step" value={selectedTask.currentStepLabel ?? "none"} />
              <Metric label="URL" value={detail?.finalUrl ?? selectedTask.finalUrl ?? "not available"} />
              <Metric label="Title" value={detail?.finalTitle ?? selectedTask.finalTitle ?? "not available"} />
            </section>

            {detail?.error ? (
              <section className="panel error-panel">
                <h3>Error</h3>
                <p>
                  {detail.error.code}: {detail.error.message}
                </p>
              </section>
            ) : null}

            <section className="workbench">
              <Panel title="Logs">
                <div className="logs">
                  {detail?.logs.map((log) => (
                    <p key={log.id}>
                      <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                      <strong>{log.level}</strong>
                      {log.message}
                    </p>
                  ))}
                </div>
              </Panel>

              <Panel title="Browser preview">
                {snapshot ? (
                  <img
                    className="preview"
                    alt="Latest browser preview"
                    src={`data:${snapshot.mimeType};base64,${snapshot.dataBase64}`}
                  />
                ) : (
                  <p className="muted">No snapshot captured yet.</p>
                )}
              </Panel>

              <Panel title="Structured state">
                <pre>{JSON.stringify(detail?.state ?? null, null, 2)}</pre>
              </Panel>

              <Panel title="Extracted data">
                <pre>{JSON.stringify(detail?.extractedData ?? {}, null, 2)}</pre>
              </Panel>
            </section>
          </>
        )}
      </section>
    </main>
  );
}

function StatusBadge({ status }: { status: TaskSummary["status"] }) {
  return <span className={`badge ${status}`}>{status}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`);
  if (!response.ok) {
    throw new Error(`Probe inspection API ${response.status} for ${path}`);
  }
  return response.json() as Promise<T>;
}
