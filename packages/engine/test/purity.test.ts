import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

/** Strips comments so documentation may mention the forbidden APIs. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("engine purity", () => {
  const files = sourceFiles(SRC);

  it("never uses ambient randomness or wall-clock time outside core/clock.ts", () => {
    for (const f of files.filter((p) => !p.endsWith(join("core", "clock.ts")))) {
      expect(code(f), f).not.toMatch(/Math\.random|Date\.now|performance\.now|new Date\(/);
    }
  });

  it("never uses platform transcendental functions or ** outside core/math.ts", () => {
    // ECMAScript lets engines approximate these differently (last-bit differences between Node
    // and browsers); core/math.ts implements log/exp with basic arithmetic only.
    for (const f of files.filter((p) => !p.endsWith(join("core", "math.ts")))) {
      expect(code(f), f).not.toMatch(
        /Math\.(log|log2|log10|log1p|exp|expm1|pow|cos|sin|tan|acos|asin|atan|atan2|cosh|sinh|tanh|cbrt|hypot)\b/,
      );
      expect(code(f), f).not.toMatch(/\*\*/);
    }
  });

  it("only the runtime entry point reads the wall clock", () => {
    const users = files.filter((f) => /core\/clock"/.test(code(f)));
    expect(users.map((f) => f.slice(SRC.length + 1).replaceAll("\\", "/"))).toEqual([
      "runtime/simulation.ts",
    ]);
  });

  it("imports no Node, DOM or third-party modules", () => {
    for (const f of files) {
      for (const m of code(f).matchAll(/from "([^"]+)"/g)) {
        expect(m[1]?.startsWith("."), `${f}: ${m[1]}`).toBe(true);
      }
    }
  });
});
