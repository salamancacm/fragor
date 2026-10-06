/** Side effects of the CLI, injected so commands are testable without a process. */
export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  readFile(path: string): string;
  writeFile(path: string, text: string): void;
}

/** A user-facing failure: printed without a stack trace, with an exit code. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export const EXIT_OK = 0;
export const EXIT_RUNTIME = 1;
export const EXIT_USAGE = 2;
