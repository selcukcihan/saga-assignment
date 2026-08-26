import type { ErrorRequestHandler, RequestHandler } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { AppError, ProviderError } from "../domain/errors.js";
import type { Logger } from "../infrastructure/logging/logger.js";

export function notFoundHandler(): RequestHandler {
  return (_request, _response, next) => next(new AppError("NOT_FOUND", "Route was not found", 404));
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _request, response, _next) => {
    const requestId = String(response.locals["requestId"] ?? "unknown");
    if (error instanceof ZodError) {
      response.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
          request_id: requestId,
        },
      });
      return;
    }
    if (error instanceof SyntaxError && "status" in error && error.status === 400) {
      response.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request body contains malformed JSON",
          request_id: requestId,
        },
      });
      return;
    }
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === "LIMIT_FILE_SIZE";
      response.status(tooLarge ? 413 : 400).json({
        error: {
          code: tooLarge ? "PAYLOAD_TOO_LARGE" : "VALIDATION_ERROR",
          message: tooLarge ? "Uploaded file is too large" : "Invalid file upload",
          request_id: requestId,
        },
      });
      return;
    }
    if (error instanceof AppError) {
      response.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
          request_id: requestId,
        },
      });
      return;
    }
    if (error instanceof ProviderError) {
      logger.warn({ err: error, requestId }, "Provider request failed");
      response.status(503).json({
        error: {
          code: "DEPENDENCY_UNAVAILABLE",
          message: "AI provider is temporarily unavailable",
          request_id: requestId,
        },
      });
      return;
    }
    logger.error({ err: error, requestId }, "Unhandled request error");
    response.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred", request_id: requestId },
    });
  };
}
