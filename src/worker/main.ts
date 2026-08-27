import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { WorkerService } from "../application/worker-service";
import { bootstrap } from "../bootstrap";

const dependencies = bootstrap();
const workerId = `worker-${randomUUID()}`;
const worker = new WorkerService(
  dependencies.jobs,
  dependencies.parsers,
  dependencies.chunker,
  dependencies.embeddings,
  workerId,
  dependencies.config.worker.leaseSeconds,
  dependencies.config.worker.retryBaseSeconds,
);
let stopping = false;

process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });

dependencies.logger.info({ workerId }, "Worker started");
while (!stopping) {
  try {
    const processed = await worker.processNext();
    if (!processed) await delay(dependencies.config.worker.pollIntervalMs);
  } catch (error) {
    dependencies.logger.error({ err: error, workerId }, "Worker loop failed");
    await delay(dependencies.config.worker.pollIntervalMs);
  }
}
dependencies.logger.info({ workerId }, "Worker stopped");
await dependencies.database.close();
