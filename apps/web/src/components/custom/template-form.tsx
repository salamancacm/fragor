"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { FaultKind, TemplateForm as Form } from "@/lib/template";

interface Props {
  form: Form;
  onChange: (next: Form) => void;
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {children}
      {hint !== undefined && <p className="text-[11px] leading-snug text-dim">{hint}</p>}
    </div>
  );
}

function Num({
  id,
  value,
  onValue,
  min = 0,
  step = 1,
  placeholder,
}: {
  id: string;
  value: number | null;
  onValue: (v: number | null) => void;
  min?: number;
  step?: number;
  placeholder?: string;
}) {
  return (
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      min={min}
      step={step}
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) => onValue(e.target.value === "" ? null : Number(e.target.value))}
    />
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-xl border p-3">
      <legend className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

const FAULT_LABEL: Record<FaultKind, string> = {
  none: "Nothing fails",
  slower: "It gets slower",
  errors: "It returns errors",
  down: "It goes down",
};

/** "My service + one dependency": numbers you can read from your configuration and metrics. */
export function TemplateForm({ form: f, onChange }: Props) {
  const set = <K extends keyof Form>(key: K, value: Form[K]) => onChange({ ...f, [key]: value });
  const num = (key: keyof Form) => (v: number | null) => set(key, (v ?? 0) as never);

  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
      <Group title="Your service">
        <Field id="t-name" label="Name">
          <Input
            id="t-name"
            value={f.serviceName}
            onChange={(e) => set("serviceName", e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="t-rps" label="Requests / s" hint="At peak, from your metrics.">
            <Num id="t-rps" value={f.rps} onValue={num("rps")} />
          </Field>
          <Field id="t-workers" label="Worker threads" hint="quarkus.thread-pool.max-threads">
            <Num id="t-workers" value={f.workers} min={1} onValue={num("workers")} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field id="t-p50" label="Own time p50 (ms)" hint="Without the dependency call.">
            <Num id="t-p50" value={f.serviceP50Ms} onValue={num("serviceP50Ms")} />
          </Field>
          <Field id="t-p99" label="Own time p99 (ms)">
            <Num id="t-p99" value={f.serviceP99Ms} onValue={num("serviceP99Ms")} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field id="t-queue" label="Queue limit" hint="Empty = unbounded. Full queue → 503.">
            <Num
              id="t-queue"
              value={f.queueLimit}
              placeholder="unbounded"
              onValue={(v) => set("queueLimit", v)}
            />
          </Field>
          <Field id="t-model" label="Threads while calling">
            <Select
              value={f.workerModel}
              onValueChange={(v) => set("workerModel", v === "async" ? "async" : "blocking")}
            >
              <SelectTrigger id="t-model" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="blocking">Wait (blocking)</SelectItem>
                <SelectItem value="async">Released (reactive)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Group>

      <Group title="The dependency it calls">
        <Field id="t-dep" label="Name">
          <Input
            id="t-dep"
            value={f.dependencyName}
            onChange={(e) => set("dependencyName", e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="t-kind" label="Who runs it">
            <Select
              value={f.dependencyKind}
              onValueChange={(v) =>
                set("dependencyKind", v === "service" ? "service" : "external-api")
              }
            >
              <SelectTrigger id="t-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="external-api">A third party</SelectItem>
                <SelectItem value="service">You (another service)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {f.dependencyKind === "service" ? (
            <Field id="t-dworkers" label="Its worker threads">
              <Num
                id="t-dworkers"
                value={f.dependencyWorkers}
                min={1}
                onValue={num("dependencyWorkers")}
              />
            </Field>
          ) : (
            <Field id="t-net" label="Network (ms)">
              <Num id="t-net" value={f.networkMs} onValue={num("networkMs")} />
            </Field>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field id="t-dp50" label="Response p50 (ms)">
            <Num id="t-dp50" value={f.dependencyP50Ms} onValue={num("dependencyP50Ms")} />
          </Field>
          <Field id="t-dp99" label="Response p99 (ms)">
            <Num id="t-dp99" value={f.dependencyP99Ms} onValue={num("dependencyP99Ms")} />
          </Field>
        </div>
        <Field id="t-err" label="Errors (%)" hint="Share of calls that fail on a normal day.">
          <Num
            id="t-err"
            value={Math.round(f.dependencyErrorRate * 1000) / 10}
            step={0.1}
            onValue={(v) => set("dependencyErrorRate", Math.max(0, Math.min(100, v ?? 0)) / 100)}
          />
        </Field>
      </Group>

      <Group title="Your resilience setup">
        <div className="grid grid-cols-2 gap-3">
          <Field
            id="t-timeout"
            label="Timeout (ms)"
            hint="@Timeout. Empty = none (30 s read timeout)."
          >
            <Num
              id="t-timeout"
              value={f.timeoutMs}
              min={1}
              placeholder="none"
              onValue={(v) => set("timeoutMs", v)}
            />
          </Field>
          <Field id="t-retries" label="Retries" hint="@Retry maxRetries">
            <Num id="t-retries" value={f.retries} onValue={num("retries")} />
          </Field>
        </div>
        {f.retries > 0 && (
          <Field id="t-delay" label="Delay between retries (ms)">
            <Num id="t-delay" value={f.retryDelayMs} onValue={num("retryDelayMs")} />
          </Field>
        )}
        {(
          [
            [
              "timeoutOnCallerPool",
              "Timeout runs on my worker pool",
              "On for a synchronous @Timeout in Quarkus.",
            ],
            ["breaker", "Circuit breaker", "@CircuitBreaker with SmallRye defaults."],
            [
              "fallback",
              "Fallback answer",
              "@Fallback: users get a degraded answer instead of an error.",
            ],
          ] as const
        ).map(([key, label, hint]) => (
          <div key={key} className="flex items-start justify-between gap-3">
            <Label htmlFor={`t-${key}`} className="text-xs leading-snug font-normal">
              <span className="font-medium">{label}</span>
              <span className="block text-[11px] text-dim">{hint}</span>
            </Label>
            <Switch
              id={`t-${key}`}
              checked={f[key]}
              disabled={key === "timeoutOnCallerPool" && f.timeoutMs === null}
              onCheckedChange={(c) => set(key, c)}
            />
          </div>
        ))}
      </Group>

      <Group title="What do you want to try?">
        <Field id="t-fault" label="The dependency…">
          <Select
            value={f.fault}
            onValueChange={(v) => {
              const fault =
                (["none", "slower", "errors", "down"] as const).find((k) => k === v) ?? "none";
              onChange({
                ...f,
                fault,
                faultAmount: fault === "errors" ? 0.5 : fault === "slower" ? 3000 : f.faultAmount,
              });
            }}
          >
            <SelectTrigger id="t-fault" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(FAULT_LABEL) as FaultKind[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {FAULT_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {f.fault === "slower" && (
          <Field id="t-amount" label="Extra latency (ms)">
            <Num id="t-amount" value={f.faultAmount} onValue={num("faultAmount")} />
          </Field>
        )}
        {f.fault === "errors" && (
          <Field id="t-amount" label="Failing calls (%)">
            <Num
              id="t-amount"
              value={Math.round(f.faultAmount * 100)}
              onValue={(v) => set("faultAmount", Math.max(0, Math.min(100, v ?? 0)) / 100)}
            />
          </Field>
        )}
        {f.fault !== "none" && (
          <div className="grid grid-cols-2 gap-3">
            <Field id="t-start" label="From second">
              <Num id="t-start" value={f.faultStartS} onValue={num("faultStartS")} />
            </Field>
            <Field id="t-for" label="For (s)">
              <Num id="t-for" value={f.faultDurationS} min={1} onValue={num("faultDurationS")} />
            </Field>
          </div>
        )}
        <Field id="t-duration" label="Simulate (s)">
          <Num id="t-duration" value={f.durationS} min={1} onValue={num("durationS")} />
        </Field>
      </Group>
    </div>
  );
}
