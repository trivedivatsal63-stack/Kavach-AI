// Pipeline phases surfaced to the UI as a Claude-style status timeline.
// Services invoke onPhase at each real step (never synthetic) so the
// frontend shows what the model is actually doing: routing (search
// decision), searching (SearXNG fetch), retrieving (RAG vector search),
// generating (LLM completion). Token deltas ride the same SSE channel
// (Phase 4) once generating starts.

export type PipelinePhase =
  | "routing"
  | "searching"
  | "retrieving"
  | "generating";

export type PhaseCallback = (phase: PipelinePhase) => void | Promise<void>;

export const PHASE_LABELS: Record<PipelinePhase, string> = {
  routing: "Deciding what to do",
  searching: "Searching the web",
  retrieving: "Retrieving documents",
  generating: "Generating answer",
};
