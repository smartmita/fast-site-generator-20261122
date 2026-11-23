import { closeSync, openSync, readFileSync, writeSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-opt');
setFlagsFromString('--no-incremental-marking');
setFlagsFromString('--max-semi-space-size=64');

const { runJson } = (await import('./solve.js')) as { runJson: (input: unknown) => string };

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(`${INPUT_DIR}/cases.json`, 'utf8')) as { id: string; input: unknown }[];
const fd = openSync(`${OUTPUT_DIR}/answers.json`, 'w');
writeSync(fd, '[');
for (let i = 0; i < cases.length; i++) {
  if (i > 0) writeSync(fd, ',');
  writeSync(fd, runJson(cases[i].input));
}
writeSync(fd, ']');
closeSync(fd);
