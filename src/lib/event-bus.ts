// [VERIFIED] — Node.js EventEmitter; one channel per pipelineId
import { EventEmitter } from "events";
import type { PipelineSSEEvent } from "@/types";

class PipelineEventBus extends EventEmitter {
  emit(pipelineId: string, event: PipelineSSEEvent): boolean {
    return super.emit(`pipeline:${pipelineId}`, event);
  }

  on(pipelineId: string, listener: (event: PipelineSSEEvent) => void): this {
    return super.on(`pipeline:${pipelineId}`, listener);
  }

  off(pipelineId: string, listener: (event: PipelineSSEEvent) => void): this {
    return super.off(`pipeline:${pipelineId}`, listener);
  }
}

// Global singleton — Next.js dev mode may load this module separately per route worker.
// Attaching to `global` guarantees every route shares the same EventEmitter instance.
const g = global as typeof global & { __pipelineBus?: PipelineEventBus };
if (!g.__pipelineBus) {
  g.__pipelineBus = new PipelineEventBus();
  g.__pipelineBus.setMaxListeners(100);
}
export const pipelineBus: PipelineEventBus = g.__pipelineBus;
