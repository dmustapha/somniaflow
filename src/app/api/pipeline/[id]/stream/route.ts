// [VERIFIED] — Next.js 14 App Router SSE pattern; ported from SOLV-001 stream route
import { NextRequest } from "next/server";
import { pipelineBus } from "@/lib/event-bus";
import { startEventListener } from "@/lib/pipeline-service";
import type { PipelineSSEEvent } from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const pipelineId = params.id;

  // Ensure the WebSocket event listener is running
  await startEventListener();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      function write(event: PipelineSSEEvent) {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(data));

        // Close SSE stream when pipeline reaches terminal state
        if (event.type === "pipeline_complete" || event.type === "pipeline_failed") {
          pipelineBus.off(pipelineId, write);
          controller.close();
        }
      }

      pipelineBus.on(pipelineId, write);

      // Send heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15_000);

      // Clean up if client disconnects
      return () => {
        clearInterval(heartbeat);
        pipelineBus.off(pipelineId, write);
      };
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection":    "keep-alive",
    },
  });
}
