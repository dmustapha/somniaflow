// [VERIFIED] — event types ported from SOLV-001; aligned with PipelineRegistry events

export type PipelineSSEEvent =
  | { type: "pipeline_started";  data: { pipelineId: string; stepCount: number } }
  | { type: "step_dispatched";   data: { step: number; agentType: string; requestId: string; timestamp: number } }
  | { type: "step_complete";     data: { step: number; result: string; durationMs: number; sttCost: string; txHash?: string } }
  // step_reasoning: full LLM output delivered as one chunk; client animates word-by-word
  // [NOTE] LLM uses streaming: false — no real token stream from contract; this is synthetic
  | { type: "step_reasoning";    data: { step: number; chunk: string } }
  | { type: "step_skipped";      data: { step: number } }
  | { type: "step_retrying";     data: { step: number; attempt: number } }
  | { type: "decision";          data: PipelineDecision }
  | { type: "pipeline_complete"; data: { pipelineId: string; totalMs: number; txHashes: string[]; simulated?: boolean } }
  | { type: "pipeline_failed";   data: { step: number; reason: string } }
  | { type: "error";             data: string };

export interface PipelineDecision {
  decision:   "EXECUTE" | "SKIP";
  reasoning:  string;
  swapPct:    number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

export type PipelineStepStatus =
  | "idle" | "pending" | "complete" | "failed" | "retrying" | "skipped";

export interface PipelineStepInput {
  agentType:        0 | 1 | 2 | 3;
  inputTemplate:    string;
  conditionalOnPrev: boolean;
  maxRetries:       number;
}

export interface PipelineStepDef {
  index:            number;
  agentType:        0 | 1 | 2 | 3;
  inputTemplate:    string;
  conditionalOnPrev: boolean;
  maxRetries:       number;
}

export interface PipelineStateView {
  pipelineId:   string;
  status:       "Idle" | "Running" | "Complete" | "Failed";
  activeStep:   number;
  stepStatuses: PipelineStepStatus[];
  sttBalance:   string;
  stepResults:  string[];
}

export interface RegisteredPipeline {
  pipelineId: string;
  owner:      string;
  stepCount:  number;
  status:     PipelineStateView["status"];
  sttBalance: string;
}
