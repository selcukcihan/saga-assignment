import type { Pool } from "pg";
import type { JobRepository, JobView } from "../../application/ports";
import type { ClaimedJob } from "../../domain/jobs";

interface JobViewRow {
  id: string;
  document_id: string;
  status: JobView["status"];
  attempt_count: number;
  max_attempts: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ClaimedJobRow {
  id: string;
  document_version_id: string;
  document_id: string;
  filename: string;
  media_type: string;
  storage_path: string;
  attempt_count: number;
  max_attempts: number;
}

function vectorLiteral(values: readonly number[]): string {
  return `[${values.join(",")}]`;
}

export class PostgresJobRepository implements JobRepository {
  constructor(private readonly pool: Pool) {}

  async find(id: string): Promise<JobView | null> {
    const result = await this.pool.query<JobViewRow>(
      `SELECT j.id, v.document_id, j.status, j.attempt_count, j.max_attempts,
              j.last_error, j.created_at, j.updated_at
         FROM ingestion_jobs j
         JOIN document_versions v ON v.id = j.document_version_id
        WHERE j.id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          documentId: row.document_id,
          status: row.status,
          attemptCount: row.attempt_count,
          maxAttempts: row.max_attempts,
          error: row.last_error,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      : null;
  }

  async claim(workerId: string, leaseSeconds: number): Promise<ClaimedJob | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const exhausted = await client.query<{ document_version_id: string }>(
        `UPDATE ingestion_jobs
            SET status = 'failed', locked_at = NULL, locked_by = NULL,
                last_error = 'Worker lease expired after final attempt', updated_at = now()
          WHERE status = 'processing'
            AND locked_at < now() - ($1 * interval '1 second')
            AND attempt_count >= max_attempts
        RETURNING document_version_id`,
        [leaseSeconds],
      );
      if (exhausted.rows.length) {
        await client.query(
          `UPDATE document_versions
              SET status = 'failed', updated_at = now()
            WHERE id = ANY($1::uuid[])`,
          [exhausted.rows.map((row) => row.document_version_id)],
        );
      }
      const result = await client.query<ClaimedJobRow>(
        `WITH candidate AS (
           SELECT id
             FROM ingestion_jobs
            WHERE available_at <= now()
              AND (
                status = 'queued'
                OR (status = 'processing' AND locked_at < now() - ($2 * interval '1 second'))
              )
              AND attempt_count < max_attempts
            ORDER BY available_at, created_at
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         ), claimed AS (
           UPDATE ingestion_jobs j
              SET status = 'processing',
                  attempt_count = j.attempt_count + 1,
                  locked_at = now(),
                  locked_by = $1,
                  updated_at = now()
             FROM candidate
            WHERE j.id = candidate.id
         RETURNING j.*
         )
         SELECT c.id, c.document_version_id, v.document_id, d.filename,
                d.media_type, d.storage_path, c.attempt_count, c.max_attempts
           FROM claimed c
           JOIN document_versions v ON v.id = c.document_version_id
           JOIN documents d ON d.id = v.document_id`,
        [workerId, leaseSeconds],
      );
      const row = result.rows[0];
      if (row) {
        await client.query(
          "UPDATE document_versions SET status = 'processing', updated_at = now() WHERE id = $1",
          [row.document_version_id],
        );
      }
      await client.query("COMMIT");
      return row
        ? {
            id: row.id,
            documentVersionId: row.document_version_id,
            documentId: row.document_id,
            filename: row.filename,
            mediaType: row.media_type,
            storagePath: row.storage_path,
            attemptCount: row.attempt_count,
            maxAttempts: row.max_attempts,
          }
        : null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(input: Parameters<JobRepository["complete"]>[0]): Promise<void> {
    if (input.chunks.length !== input.embeddings.length) {
      throw new Error("Chunk and embedding counts differ");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM chunks WHERE document_version_id = $1", [input.job.documentVersionId]);
      for (const [index, chunk] of input.chunks.entries()) {
        const embedding = input.embeddings[index];
        if (!embedding) throw new Error("Missing embedding for chunk");
        await client.query(
          `INSERT INTO chunks
             (id, document_version_id, ordinal, content, content_hash, source_locator, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7::vector)`,
          [
            chunk.id,
            input.job.documentVersionId,
            chunk.ordinal,
            chunk.content,
            chunk.contentHash,
            chunk.locator,
            vectorLiteral(embedding),
          ],
        );
      }
      await client.query(
        "UPDATE document_versions SET status = 'ready', updated_at = now() WHERE id = $1",
        [input.job.documentVersionId],
      );
      await client.query(
        `UPDATE ingestion_jobs
            SET status = 'completed', locked_at = NULL, locked_by = NULL,
                last_error = NULL, updated_at = now()
          WHERE id = $1`,
        [input.job.id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async fail(input: Parameters<JobRepository["fail"]>[0]): Promise<void> {
    const willRetry = input.retryable && input.job.attemptCount < input.job.maxAttempts;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE ingestion_jobs
            SET status = $2::job_status,
                available_at = CASE WHEN $2::job_status = 'queued' THEN now() + ($3 * interval '1 second') ELSE available_at END,
                locked_at = NULL, locked_by = NULL, last_error = $4, updated_at = now()
          WHERE id = $1`,
        [input.job.id, willRetry ? "queued" : "failed", input.retryDelaySeconds, input.error],
      );
      await client.query(
        "UPDATE document_versions SET status = $2::document_status, updated_at = now() WHERE id = $1",
        [input.job.documentVersionId, willRetry ? "pending" : "failed"],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
