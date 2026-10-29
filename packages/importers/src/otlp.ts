/**
 * Reader of OpenTelemetry traces in OTLP/JSON, the format the OpenTelemetry Collector's file
 * exporter writes (one `{"resourceSpans": [...]}` per line) and OTLP/HTTP carries. Field rules follow
 * the OTLP specification (https://opentelemetry.io/docs/specs/otlp/): ids are hex strings, 64-bit
 * integers are decimal strings, enums are integers, keys are lowerCamelCase.
 */

export type SpanKind = "internal" | "server" | "client" | "producer" | "consumer" | "unspecified";

/** A span, reduced to what Fragor reads. Times are milliseconds since the Unix epoch. */
export interface Span {
  traceId: string;
  spanId: string;
  /** Null for a span that starts a trace (no parent was recorded). */
  parentSpanId: string | null;
  /** The `service.name` of its resource. */
  service: string;
  name: string;
  kind: SpanKind;
  startMs: number;
  endMs: number;
  /** The span's status is ERROR. */
  error: boolean;
  /** `http.response.status_code`, when the span has one. */
  httpStatus: number | null;
  /** `server.address:server.port` of a client span: who it called. */
  peer: string | null;
}

export interface ParsedOtlp {
  spans: Span[];
  /** Lines or documents that could not be read, as messages naming the line. */
  problems: string[];
}

const KINDS: Record<string, SpanKind> = {
  "0": "unspecified",
  "1": "internal",
  "2": "server",
  "3": "client",
  "4": "producer",
  "5": "consumer",
  SPAN_KIND_UNSPECIFIED: "unspecified",
  SPAN_KIND_INTERNAL: "internal",
  SPAN_KIND_SERVER: "server",
  SPAN_KIND_CLIENT: "client",
  SPAN_KIND_PRODUCER: "producer",
  SPAN_KIND_CONSUMER: "consumer",
};

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** A 64-bit unsigned time in nanoseconds (a decimal string, or a number) as milliseconds. */
function nanosToMs(v: unknown): number | null {
  try {
    if (typeof v === "string" && /^\d+$/.test(v)) return Number(BigInt(v) / 1000n) / 1000;
    if (typeof v === "number" && Number.isFinite(v)) return v / 1e6;
  } catch {
    return null;
  }
  return null;
}

/** The value of an OTLP attribute (`stringValue`, `intValue`, ...), as a string or number. */
function attrValue(a: unknown): string | number | null {
  if (!isObj(a) || !isObj(a.value)) return null;
  const v = a.value;
  if (typeof v.stringValue === "string") return v.stringValue;
  if (typeof v.intValue === "string" && /^-?\d+$/.test(v.intValue)) return Number(v.intValue);
  if (typeof v.intValue === "number") return v.intValue;
  return null;
}

function attributes(list: unknown): Map<string, string | number> {
  const out = new Map<string, string | number>();
  if (!Array.isArray(list)) return out;
  for (const a of list) {
    const value = attrValue(a);
    if (value !== null && isObj(a) && typeof a.key === "string") out.set(a.key, value);
  }
  return out;
}

function statusIsError(status: unknown): boolean {
  if (!isObj(status)) return false;
  return status.code === 2 || status.code === "STATUS_CODE_ERROR";
}

function toSpan(raw: unknown, service: string): Span | null {
  if (!isObj(raw) || typeof raw.traceId !== "string" || typeof raw.spanId !== "string") return null;
  const startMs = nanosToMs(raw.startTimeUnixNano);
  const endMs = nanosToMs(raw.endTimeUnixNano);
  if (startMs === null || endMs === null || endMs < startMs) return null;
  const attrs = attributes(raw.attributes);
  const status = attrs.get("http.response.status_code");
  const host = attrs.get("server.address");
  const port = attrs.get("server.port");
  return {
    traceId: raw.traceId,
    spanId: raw.spanId,
    parentSpanId:
      typeof raw.parentSpanId === "string" && raw.parentSpanId !== "" ? raw.parentSpanId : null,
    service,
    name: typeof raw.name === "string" ? raw.name : "",
    kind: KINDS[String(raw.kind ?? 0)] ?? "unspecified",
    startMs,
    endMs,
    error: statusIsError(raw.status),
    httpStatus: typeof status === "number" ? status : null,
    peer: typeof host === "string" ? (port === undefined ? host : `${host}:${port}`) : null,
  };
}

/** The spans of one `{"resourceSpans": [...]}` document. */
function readDocument(doc: unknown, spans: Span[]): boolean {
  if (!isObj(doc) || !Array.isArray(doc.resourceSpans)) return false;
  for (const rs of doc.resourceSpans) {
    if (!isObj(rs)) continue;
    const resource = isObj(rs.resource) ? attributes(rs.resource.attributes) : new Map();
    const name = resource.get("service.name");
    const service = typeof name === "string" && name !== "" ? name : "unknown_service";
    for (const ss of Array.isArray(rs.scopeSpans) ? rs.scopeSpans : []) {
      if (!isObj(ss) || !Array.isArray(ss.spans)) continue;
      for (const raw of ss.spans) {
        const span = toSpan(raw, service);
        if (span !== null) spans.push(span);
      }
    }
  }
  return true;
}

/**
 * Reads OTLP/JSON traces: newline-delimited documents (the Collector's file exporter), a single
 * document, or an array of documents. Lines that are not traces are reported, not fatal.
 */
export function parseOtlp(text: string): ParsedOtlp {
  const spans: Span[] = [];
  const problems: string[] = [];
  const trimmed = text.trim();
  if (trimmed === "") return { spans, problems: ["The file is empty."] };

  // One JSON value (a document, or an array of them), e.g. a response saved from OTLP/HTTP.
  if (trimmed.startsWith("[")) {
    try {
      const docs: unknown = JSON.parse(trimmed);
      if (Array.isArray(docs)) {
        docs.forEach((d, i) => {
          if (!readDocument(d, spans)) problems.push(`Item ${i + 1} has no resourceSpans.`);
        });
        return { spans, problems };
      }
    } catch {
      // Not one JSON value: fall through to line by line.
    }
  }

  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (line.trim() === "") return;
    try {
      if (!readDocument(JSON.parse(line), spans))
        problems.push(`Line ${i + 1} has no resourceSpans.`);
    } catch {
      problems.push(`Line ${i + 1} is not valid JSON.`);
    }
  });
  // A pretty-printed single document spans many lines and fails line by line: try it whole.
  if (spans.length === 0 && problems.length > 0) {
    try {
      if (readDocument(JSON.parse(trimmed), spans)) return { spans, problems: [] };
    } catch {
      // Keep the line problems.
    }
  }
  return { spans, problems };
}
