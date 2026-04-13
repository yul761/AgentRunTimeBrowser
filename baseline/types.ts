export type Action =
  | {
      type: "fill_search";
      query: string;
    }
  | {
      type: "press_enter";
    }
  | {
      type: "toggle_open_now";
    }
  | {
      type: "sort_by_rating";
    }
  | {
      type: "apply_filters";
    }
  | {
      type: "extract_results";
    }
  | {
      type: "done";
    };

export interface StepLog {
  step: number;
  url: string;
  title: string;
  action: Action;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  extractedResults?: string[];
  googleBlocked?: boolean;
  fallbackUsed?: boolean;
  note?: string;
}

export interface BenchmarkResult {
  steps: StepLog[];
  totalTokens: number;
  totalLatencyMs: number;
  extractedResults: string[];
  target: "google" | "fixture" | "live_web" | "complex_fixture";
  liveGoogleStatus: "ok" | "blocked";
  fallbackUsed: boolean;
  blockReason?: string;
}

export type BenchmarkTarget = BenchmarkResult["target"];
