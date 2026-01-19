import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { FacetSchemaFile } from './library';

const DEFAULT_FACET_SCHEMA: FacetSchemaFile = {
  columns: [
    {
      key: 'tags',
      displayName: 'Tags',
      type: 'multi',
      values: [
        { key: 'work', displayName: 'Work' },
        { key: 'personal', displayName: 'Personal' },
      ],
    },
    {
      key: 'classification',
      displayName: 'Classification',
      type: 'single',
      values: [
        { key: 'serif', displayName: 'Serif' },
        { key: 'sans', displayName: 'Sans' },
        { key: 'display', displayName: 'Display' },
      ],
    },
    {
      key: 'favorite',
      displayName: 'Favorite',
      type: 'boolean',
    },
  ],
};

export const ensureFacetSchema = async (libraryRoot: string): Promise<FacetSchemaFile> => {
  const schemaPath = join(libraryRoot, 'facet-schema.json');
  try {
    const contents = await fs.readFile(schemaPath, 'utf-8');
    const parsed = JSON.parse(contents) as FacetSchemaFile;
    if (!parsed.columns) {
      throw new Error('Missing columns');
    }
    return parsed;
  } catch {
    await fs.writeFile(schemaPath, JSON.stringify(DEFAULT_FACET_SCHEMA, null, 2), 'utf-8');
    return DEFAULT_FACET_SCHEMA;
  }
};
