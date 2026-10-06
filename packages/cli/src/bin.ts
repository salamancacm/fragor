import { readFileSync, writeFileSync } from "node:fs";
import { main } from "./main";

process.exitCode = main(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readFile: (path) => readFileSync(path, "utf8"),
  writeFile: (path, text) => writeFileSync(path, text, "utf8"),
});
