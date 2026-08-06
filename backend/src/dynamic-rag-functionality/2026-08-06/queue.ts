import { ingestDocument, type IngestionInput } from "./services/ingestion";

// Minimal in-process job queue. Uploads enqueue and return immediately; a
// single worker drains the queue serially so embedding load stays bounded on
// small machines. Jobs are memory-held (the raw buffer rides along), which
// is fine at personal-project scale.
//
// Known limitation: a backend restart loses queued jobs — documents.ts
// markInterruptedAsFailed() flips any queued/processing rows to failed on
// startup so the UI never shows a permanent "processing" spinner.

const queue: IngestionInput[] = [];
let running = false;

export function enqueueIngestion(job: IngestionInput): void {
  queue.push(job);
  if (!running) {
    running = true;
    void drain();
  }
}

async function drain(): Promise<void> {
  while (queue.length > 0) {
    const job = queue.shift()!;
    try {
      await ingestDocument(job);
    } catch (err) {
      // Status is already marked failed inside ingestDocument; log so the
      // worker keeps going for the next job.
      console.error(`[rag] ingest ${job.documentId} failed:`, err);
    }
  }
  running = false;
}

export function pendingJobs(): number {
  return queue.length;
}
