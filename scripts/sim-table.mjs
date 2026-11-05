// Launcher for `npm run sim:table`: loads scripts/simTable.ts through Vite's
// module runner (TypeScript + extensionless imports, no extra dependencies).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await runnerImport(resolve(root, 'scripts/simTable.ts'), { root, logLevel: 'error' });
