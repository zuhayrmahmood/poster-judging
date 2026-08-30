/**
 * Finishes the standalone build.
 *
 * `next build` deliberately leaves `public/` and `.next/static/` out of
 * `.next/standalone`, on the assumption a CDN serves them. There is no CDN here — the
 * organiser's laptop serves everything — so they have to be copied in, along with the
 * migrations the server applies at boot.
 */

import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");

const copies = [
  ["public", "public"],
  [path.join(".next", "static"), path.join(".next", "static")],
  [path.join("db", "migrations"), path.join("db", "migrations")],
];

for (const [from, to] of copies) {
  const target = path.join(standalone, to);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(path.join(root, from), target, { recursive: true });
  console.log(`copied ${from} -> .next/standalone/${to}`);
}
