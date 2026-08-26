import pino from "pino";

export function createLogger(level: pino.LevelWithSilent) {
  return pino({
    level,
    redact: {
      paths: ["req.headers.authorization", "*.apiKey", "error.stack"],
      censor: "[REDACTED]",
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
