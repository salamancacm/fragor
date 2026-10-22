"use client";

import type { Scenario } from "@fragor/engine";
import { Download, FileUp, Play, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { readScenario, scenarioJson } from "@/lib/import";
import {
  checkTemplate,
  DEFAULT_TEMPLATE,
  type TemplateForm as Form,
  templateScenario,
} from "@/lib/template";
import { TemplateForm } from "./template-form";

interface Props {
  /** The scenario currently shown (with what-if changes), to edit or download. */
  current: Scenario | null;
  onRun: (scenario: Scenario) => void;
  onClose: () => void;
}

/** Remembered in this browser only, so a reload does not lose the user's work. */
const STORAGE_KEY = "fragor.custom.v1";

interface Saved {
  form: Form;
  json: string;
}

function load(): Saved | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null || !("form" in v) || !("json" in v)) return null;
    const { form, json } = v as { form: unknown; json: unknown };
    if (typeof json !== "string" || typeof form !== "object" || form === null) return null;
    // Unknown or missing keys fall back to the defaults (older saves, hand edits).
    return { form: { ...DEFAULT_TEMPLATE, ...(form as Partial<Form>) }, json };
  } catch {
    return null;
  }
}

function save(s: Saved): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage blocked or full: the page works the same, it just forgets on reload.
  }
}

export function downloadScenario(s: Scenario): void {
  const url = URL.createObjectURL(new Blob([scenarioJson(s)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${s.name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "scenario"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function Errors({ errors }: { errors: readonly string[] }) {
  if (errors.length === 0) return null;
  return (
    <div role="alert" className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm">
      <p className="font-semibold text-bad">
        Fix {errors.length === 1 ? "this" : `these ${errors.length} problems`} first:
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 font-mono text-xs text-foreground/90">
        {errors.slice(0, 12).map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
      {errors.length > 12 && (
        <p className="mt-1 text-xs text-muted-foreground">…and {errors.length - 12} more.</p>
      )}
    </div>
  );
}

/** Model your own system: a quick form for one service and its dependency, or any scenario as JSON. */
export function CustomScenario({ current, onRun, onClose }: Props) {
  const [tab, setTab] = useState("form");
  const [form, setForm] = useState<Form>(DEFAULT_TEMPLATE);
  const [json, setJson] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const file = useRef<HTMLInputElement | null>(null);
  const loaded = useRef(false);

  // Restore after mount (the page is prerendered, so no storage access during render).
  useEffect(() => {
    const s = load();
    if (s !== null) {
      setForm(s.form);
      setJson(s.json);
    }
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (loaded.current) save({ form, json });
  }, [form, json]);

  const runForm = () => {
    const r = checkTemplate(form);
    if (!r.ok) return setErrors(r.issues.map((i) => `${i.path}: ${i.message}`));
    setErrors([]);
    onRun(r.scenario);
  };
  const runJson = () => {
    const r = readScenario(json);
    if (!r.ok) return setErrors(r.errors);
    setErrors([]);
    onRun(r.scenario);
  };

  return (
    <section
      className="mt-4 rounded-2xl border border-ok/30 bg-card p-4"
      aria-label="Your scenario"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h2 className="text-lg font-semibold">Model your own system</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Fragor does not connect to your services yet: you describe them with numbers from your
            configuration and metrics, and it simulates what happens when something fails. Start
            with the quick form, or paste a full scenario. Nothing leaves your browser.
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <X />
        </Button>
      </div>

      <Tabs
        value={tab}
        onValueChange={(t) => {
          setTab(t);
          setErrors([]);
        }}
        className="mt-3"
      >
        <TabsList>
          <TabsTrigger value="form">Quick form: one service + one dependency</TabsTrigger>
          <TabsTrigger value="json">JSON: any architecture</TabsTrigger>
        </TabsList>

        <TabsContent value="form" className="space-y-3 pt-2">
          <TemplateForm form={form} onChange={setForm} />
          <Errors errors={errors} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={runForm}>
              <Play aria-hidden /> Run my scenario
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setJson(scenarioJson(templateScenario(form)));
                setErrors([]);
                setTab("json");
              }}
              title="Open this scenario as JSON to add services, edges or faults"
            >
              Continue in JSON
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="json" className="space-y-3 pt-2">
          <p className="text-sm text-muted-foreground">
            Same format as the CLI (<code className="font-mono text-xs">fragor run</code>) and the
            examples in <code className="font-mono text-xs">packages/scenarios/examples</code>.
            Services are <code className="font-mono text-xs">nodes</code>, calls are{" "}
            <code className="font-mono text-xs">edges</code> with their policies, plus{" "}
            <code className="font-mono text-xs">traffic</code> and{" "}
            <code className="font-mono text-xs">faults</code>.
          </p>
          <textarea
            value={json}
            onChange={(e) => setJson(e.target.value)}
            spellCheck={false}
            aria-label="Scenario JSON"
            placeholder='{ "schemaVersion": 1, "name": "my-system", ... }'
            className="h-80 w-full resize-y rounded-lg border bg-background p-3 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Errors errors={errors} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={runJson}>
              <Play aria-hidden /> Validate and run
            </Button>
            <Button variant="outline" onClick={() => file.current?.click()}>
              <FileUp aria-hidden /> Open a file…
            </Button>
            <input
              ref={file}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f === undefined) return;
                setJson(await f.text());
                setErrors([]);
              }}
            />
            {current !== null && (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setJson(scenarioJson(current));
                    setErrors([]);
                  }}
                  title="Start from the scenario on screen, with your what-if changes"
                >
                  Load the scenario on screen
                </Button>
                <Button variant="ghost" onClick={() => downloadScenario(current)}>
                  <Download aria-hidden /> Download it
                </Button>
              </>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}
