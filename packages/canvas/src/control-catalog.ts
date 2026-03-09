export interface CanvasControlCatalogSource {
  family: 'classic' | 'modern';
  learnUrl: string;
  markdownUrl: string;
}

export interface CanvasControlCatalogEntry {
  family: 'classic' | 'modern';
  name: string;
  description: string;
  docPath: string;
  learnUrl: string;
  markdownUrl: string;
  status: string[];
}

export interface CanvasControlCatalogDocument {
  schemaVersion: 1;
  generatedAt: string;
  sources: CanvasControlCatalogSource[];
  controls: CanvasControlCatalogEntry[];
}

export const CANVAS_CONTROL_CATALOG_SOURCES: CanvasControlCatalogSource[] = [
  {
    family: 'classic',
    learnUrl: 'https://learn.microsoft.com/en-us/power-apps/maker/canvas-apps/reference-properties',
    markdownUrl: 'https://raw.githubusercontent.com/MicrosoftDocs/powerapps-docs/live/powerapps-docs/maker/canvas-apps/reference-properties.md',
  },
  {
    family: 'modern',
    learnUrl: 'https://learn.microsoft.com/en-us/power-apps/maker/canvas-apps/controls/modern-controls/modern-controls-reference',
    markdownUrl:
      'https://raw.githubusercontent.com/MicrosoftDocs/powerapps-docs/live/powerapps-docs/maker/canvas-apps/controls/modern-controls/modern-controls-reference.md',
  },
];

export async function fetchCanvasControlCatalogDocument(
  sources: CanvasControlCatalogSource[] = CANVAS_CONTROL_CATALOG_SOURCES
): Promise<CanvasControlCatalogDocument> {
  const controls = (
    await Promise.all(
      sources.map(async (source) => parseCanvasControlCatalogMarkdown(await fetchText(source.markdownUrl), source))
    )
  )
    .flat()
    .sort((left, right) => left.family.localeCompare(right.family) || left.name.localeCompare(right.name));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sources,
    controls,
  };
}

export function parseCanvasControlCatalogMarkdown(
  markdown: string,
  source: CanvasControlCatalogSource
): CanvasControlCatalogEntry[] {
  const entries: CanvasControlCatalogEntry[] = [];
  const lines = extractSectionLines(markdown, source.family === 'classic' ? '## Controls' : '## Modern controls');

  for (const line of lines) {
    const match = line.match(/^\*\*\[([^\]]+)\]\(([^)]+)\)\*\*\s*[–-]\s*(.+)\s*$/);
    if (!match) {
      continue;
    }

    const [, rawName, docPath, description] = match;
    if (!rawName || !docPath || !description) {
      continue;
    }
    const statuses = [...rawName.matchAll(/\(([^)]+)\)/g)]
      .map((statusMatch) => statusMatch[1]?.trim().toLowerCase())
      .filter((status): status is string => Boolean(status));
    const name = rawName.replace(/\s*\([^)]+\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

    entries.push({
      family: source.family,
      name,
      description: description.trim(),
      docPath,
      learnUrl: new URL(docPath, source.learnUrl).toString(),
      markdownUrl: source.markdownUrl,
      status: statuses,
    });
  }

  return dedupeCatalogEntries(entries);
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function extractSectionLines(markdown: string, heading: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) {
    return [];
  }

  const section: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }
    if (/^##\s+/.test(line) || /^###\s+/.test(line)) {
      break;
    }
    section.push(line);
  }

  return section;
}

function dedupeCatalogEntries(entries: CanvasControlCatalogEntry[]): CanvasControlCatalogEntry[] {
  const seen = new Set<string>();
  const deduped: CanvasControlCatalogEntry[] = [];

  for (const entry of entries) {
    const key = `${entry.family}:${entry.name.toLowerCase()}:${entry.docPath.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
}
