"use client";

import type { Question } from "@fragor/importers";
import type { PatchOp } from "@fragor/scenarios";
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { type Answer, answerOps, answerProblem, initialAnswer, kindOf } from "@/lib/import-answers";

interface Props {
  question: Question;
  /** The value now at the question's path in the draft. */
  current: unknown;
  onApply: (path: string, ops: PatchOp[]) => void;
}

const num = (text: string): number | null => (text.trim() === "" ? null : Number(text));

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

/** The inputs of one kind of question; `answer` is what they currently say. */
function Editor({ answer, onChange }: { answer: Answer; onChange: (a: Answer) => void }) {
  const id = useId();
  switch (answer.kind) {
    case "workers":
      return (
        <Field id={id} label="Worker threads">
          <Input
            id={id}
            type="number"
            min={1}
            value={answer.value}
            onChange={(e) => onChange({ ...answer, value: Number(e.target.value) })}
          />
        </Field>
      );
    case "queueLimit":
      return (
        <Field id={id} label="Waiting queue (empty = no limit)">
          <Input
            id={id}
            type="number"
            min={0}
            placeholder="no limit"
            value={answer.value ?? ""}
            onChange={(e) => onChange({ ...answer, value: num(e.target.value) })}
          />
        </Field>
      );
    case "workerModel":
      return (
        <Field id={id} label="While it waits for its dependencies, a thread…">
          <Select
            value={answer.value}
            onValueChange={(v) =>
              onChange({ ...answer, value: v === "async" ? "async" : "blocking" })
            }
          >
            <SelectTrigger id={id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="blocking">waits (blocking)</SelectItem>
              <SelectItem value="async">is released (reactive)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      );
    case "serviceTime":
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field id={`${id}-p50`} label="Own time p50 (ms)">
            <Input
              id={`${id}-p50`}
              type="number"
              min={0}
              value={answer.p50Ms}
              onChange={(e) => onChange({ ...answer, p50Ms: Number(e.target.value) })}
            />
          </Field>
          <Field id={`${id}-p99`} label="Own time p99 (ms)">
            <Input
              id={`${id}-p99`}
              type="number"
              min={0}
              value={answer.p99Ms}
              onChange={(e) => onChange({ ...answer, p99Ms: Number(e.target.value) })}
            />
          </Field>
        </div>
      );
    case "timeout":
      return (
        <Field id={id} label="Timeout in ms (empty = none)">
          <Input
            id={id}
            type="number"
            min={1}
            placeholder="none"
            value={answer.valueMs ?? ""}
            onChange={(e) => onChange({ ...answer, valueMs: num(e.target.value) })}
          />
        </Field>
      );
    case "retry":
      return (
        <Field id={id} label="Retries after the first attempt (0 = none)">
          <Input
            id={id}
            type="number"
            min={0}
            max={100}
            value={answer.retries}
            onChange={(e) => onChange({ ...answer, retries: Number(e.target.value) })}
          />
        </Field>
      );
    case "breaker":
    case "fallback":
      return (
        <div className="flex items-center gap-2">
          <Switch
            id={id}
            checked={answer.on}
            onCheckedChange={(on) => onChange({ ...answer, on })}
          />
          <Label htmlFor={id} className="text-sm font-normal">
            {answer.kind === "breaker" ? "Has a circuit breaker" : "Has a fallback"}
          </Label>
        </div>
      );
  }
}

/** One open question of the import, with the form that answers it. */
export function AnswerForm({ question, current, onApply }: Props) {
  const kind = kindOf(question.path);
  const [answer, setAnswer] = useState<Answer | null>(
    kind === null ? null : initialAnswer(kind, current),
  );
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <li className="rounded-xl border bg-muted/30 p-3">
      <p className="text-sm font-medium">{question.ask}</p>
      {question.hint !== undefined && <p className="mt-0.5 text-xs text-dim">{question.hint}</p>}
      {answer === null ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Answer it in the JSON tab: <code className="font-mono">{question.path}</code>
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <Editor
              answer={answer}
              onChange={(a) => {
                setAnswer(a);
                setProblem(null);
              }}
            />
          </div>
          <Button
            size="sm"
            onClick={() => {
              const p = answerProblem(answer);
              if (p !== null) return setProblem(p);
              onApply(question.path, answerOps(question.path, answer, current));
            }}
          >
            Apply
          </Button>
        </div>
      )}
      {problem !== null && (
        <p role="alert" className="mt-1.5 text-xs text-bad">
          {problem}
        </p>
      )}
    </li>
  );
}
