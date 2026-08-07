import { ingestDocument, type IngestionInput } from "../services/rag/ingestion.service";

// Minimal in-process job queue. Uploads enqueue and return immediately; a
// single worker drains the queue serially so embedding load stays bounded.

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
      console.error(`[rag] ingest ${job.documentId} failed:`, err);
    }
  }
  running = false;
}

export function pendingJobs(): number {
  return queue.length;
}
