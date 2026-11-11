// Fails when the shipped client build is over the 12 MB browser budget.
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUDGET = 12 * 1024 * 1024;
const dist = fileURLToPath(new URL('../client/dist', import.meta.url));

const walk = async (dir) => {
  let total = 0;
  const rows = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await walk(path);
      total += sub.total;
      rows.push(...sub.rows);
    } else {
      const size = (await stat(path)).size;
      total += size;
      rows.push([path.slice(dist.length + 1), size]);
    }
  }
  return { total, rows };
};

const { total, rows } = await walk(dist);
rows.sort((a, b) => b[1] - a[1]);
for (const [path, size] of rows.slice(0, 15)) console.log(`${(size / 1024).toFixed(1).padStart(9)} KB  ${path}`);
console.log(`\ntotal ${(total / 1024 / 1024).toFixed(2)} MB of ${(BUDGET / 1024 / 1024).toFixed(0)} MB budget`);
if (total > BUDGET) {
  console.error('client build is over budget');
  process.exit(1);
}
