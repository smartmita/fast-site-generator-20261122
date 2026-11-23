import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { run, solveCasesToBuffer } = require('./core.cjs');

export { run, solveCasesToBuffer };
