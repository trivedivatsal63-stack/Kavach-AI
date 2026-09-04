import { useState } from "react";
import { Spinner } from "../Spinner";
import { CheckCircleIcon } from "../icons";

export type AgentPhase = "routing" | "searching" | "retrieving" | "generating";

const PHASE_LABELS: Record<AgentPhase, string> = {
  routing: "Deciding what to do",
  searching: "Searching the web",
  retrieving: "Retrieving documents",
  generating: "Generating answer",
};

// Claude-style collapsible status timeline. Steps come only from real SSE
// `status` events emitted by the backend pipeline — the UI never invents
// phases. Shows the active step with a spinner, completed steps collapse
// into a one-line summary once done.
export function AgentStatus({
  phases,
  active,
}: {
  /** Phases seen so far, in arrival order. */
  phases: AgentPhase[];
  /** True while the request is still in flight. */
  active: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  if (phases.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Spinner />
        Thinking…
      </div>
    );
  }

  if (!active && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex items-center gap-1.5 text-xs text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
      >
        <CheckCircleIcon className="h-3.5 w-3.5" />
        {phases.map((p) => PHASE_LABELS[p]).join(" · ")}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {phases.map((phase, i) => {
        const isLast = i === phases.length - 1;
        const done = !isLast || !active;
        return (
          <div key={`${phase}-${i}`} className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            {done ? (
              <CheckCircleIcon className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
            ) : (
              <Spinner />
            )}
            <span>{PHASE_LABELS[phase]}</span>
          </div>
        );
      })}
      {!active && (
        <button
          onClick={() => setExpanded(false)}
          className="self-start text-xs text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
        >
          Collapse
        </button>
      )}
    </div>
  );
}
