import { createApp } from "./create-app.js";
import { bootstrap } from "../bootstrap.js";

const dependencies = bootstrap();
const app = createApp({
  ingestion: dependencies.ingestion,
  chat: dependencies.chat,
  jobs: dependencies.jobs,
  files: dependencies.files,
  logger: dependencies.logger,
  uploadDirectory: dependencies.config.upload.directory,
  maxUploadBytes: dependencies.config.upload.maxBytes,
});
const server = app.listen(dependencies.config.server.port, dependencies.config.server.host, () => {
  dependencies.logger.info(
    { host: dependencies.config.server.host, port: dependencies.config.server.port },
    "API listening",
  );
});

async function shutdown(signal: string) {
  dependencies.logger.info({ signal }, "Shutting down API");
  server.close(async () => {
    await dependencies.database.close();
    process.exit(0);
  });
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
