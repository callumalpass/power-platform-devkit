import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { writeJsonFile } from '@pp/artifacts';
import { fetchCanvasControlCatalogDocument } from '@pp/canvas';

async function main(): Promise<void> {
  const outPath = resolve(readArg('--out') ?? 'registries/canvas-control-catalog.json');
  const document = await fetchCanvasControlCatalogDocument();

  await mkdir(dirname(outPath), { recursive: true });
  await writeJsonFile(outPath, document as unknown as Parameters<typeof writeJsonFile>[1]);

  process.stdout.write(`Wrote ${document.controls.length} controls to ${outPath}\n`);
}

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
