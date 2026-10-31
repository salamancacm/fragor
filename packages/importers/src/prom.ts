/** One sample of the Prometheus text exposition format: `name{label="value"} 1.5`. */
export interface Sample {
  name: string;
  labels: Readonly<Record<string, string>>;
  value: number;
}

export interface ParsedProm {
  samples: Sample[];
  /** The lines that could not be read, each with its line number. */
  problems: string[];
}

const NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*/;
const LABEL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*/;

const SPECIAL: Record<string, number> = {
  NaN: Number.NaN,
  "+Inf": Number.POSITIVE_INFINITY,
  Inf: Number.POSITIVE_INFINITY,
  "-Inf": Number.NEGATIVE_INFINITY,
};

function number(text: string): number | null {
  const special = SPECIAL[text];
  if (special !== undefined) return special;
  const n = Number(text);
  return text === "" || Number.isNaN(n) ? null : n;
}

/** The quoted value starting at `from` (a `"`); returns it unescaped and where it ended. */
function quoted(line: string, from: number): { value: string; end: number } | null {
  let out = "";
  for (let i = from + 1; i < line.length; i++) {
    const c = line[i] as string;
    if (c === '"') return { value: out, end: i + 1 };
    if (c !== "\\") {
      out += c;
      continue;
    }
    i++;
    const e = line[i];
    if (e === "n") out += "\n";
    else if (e === "\\" || e === '"') out += e;
    else return null;
  }
  return null;
}

/** The labels of `{...}` starting at `from`; returns them and the index after the closing brace. */
function labels(
  line: string,
  from: number,
): { labels: Record<string, string>; end: number } | null {
  const out: Record<string, string> = {};
  let i = from + 1;
  for (;;) {
    while (line[i] === " " || line[i] === ",") i++;
    if (line[i] === "}") return { labels: out, end: i + 1 };
    const name = LABEL_NAME.exec(line.slice(i))?.[0];
    if (name === undefined || line[i + name.length] !== "=" || line[i + name.length + 1] !== '"')
      return null;
    const value = quoted(line, i + name.length + 1);
    if (value === null) return null;
    out[name] = value.value;
    i = value.end;
  }
}

function sample(line: string): Sample | null {
  const name = NAME.exec(line)?.[0];
  if (name === undefined) return null;
  let rest = line.slice(name.length);
  let parsed: Record<string, string> = {};
  if (rest.startsWith("{")) {
    const l = labels(rest, 0);
    if (l === null) return null;
    parsed = l.labels;
    rest = rest.slice(l.end);
  }
  if (!rest.startsWith(" ") && !rest.startsWith("\t")) return null;
  const [value, timestamp, extra] = rest.trim().split(/\s+/);
  if (value === undefined || extra !== undefined) return null;
  const n = number(value);
  if (n === null || (timestamp !== undefined && number(timestamp) === null)) return null;
  return { name, labels: parsed, value: n };
}

/**
 * Reads the Prometheus text format (what `/q/metrics` or any exporter serves). Comment lines
 * (`# HELP`, `# TYPE`) and blank lines are skipped; a line that cannot be read is reported and the
 * rest is kept. A trailing timestamp is accepted and ignored.
 */
export function parseProm(text: string): ParsedProm {
  const samples: Sample[] = [];
  const problems: string[] = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const s = sample(line);
    if (s === null) problems.push(`line ${i + 1} is not a sample: ${line.slice(0, 80)}`);
    else samples.push(s);
  });
  return { samples, problems };
}
