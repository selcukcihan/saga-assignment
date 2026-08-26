export type JobStatus = "queued" | "processing" | "completed" | "failed";
export type DocumentStatus = "pending" | "processing" | "ready" | "failed";

export interface ClaimedJob {
  id: string;
  documentVersionId: string;
  documentId: string;
  filename: string;
  mediaType: string;
  storagePath: string;
  attemptCount: number;
  maxAttempts: number;
}
