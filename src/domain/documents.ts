export const supportedMediaTypes = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "application/json",
] as const;

export type SupportedMediaType = (typeof supportedMediaTypes)[number];

export interface SourceLocator {
  format: "pdf" | "docx" | "csv" | "json";
  page?: number;
  paragraph_start?: number;
  paragraph_end?: number;
  heading?: string;
  row_start?: number;
  row_end?: number;
  json_path?: string;
  part?: number;
}

export interface SourceBlock {
  content: string;
  locator: SourceLocator;
}

export interface DocumentChunk {
  id: string;
  ordinal: number;
  content: string;
  contentHash: string;
  locator: SourceLocator;
}

export interface Citation {
  chunkId: string;
  documentId: string;
  filename: string;
  rank: number;
  similarity: number;
  locator: SourceLocator;
  excerpt: string;
}

export function isSupportedMediaType(value: string): value is SupportedMediaType {
  return supportedMediaTypes.includes(value as SupportedMediaType);
}
