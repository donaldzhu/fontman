import Database from 'better-sqlite3';
import { promises as fs } from 'node:fs';
import { join, extname } from 'node:path';
import type {
  LibraryFamily,
  LibraryFace,
  LibrarySource,
  ScanFileResult,
  FacetColumn,
  FacetColumnType,
} from '@fontman/shared/src/protocol';

type FacetSchemaValue = {
  key: string;
  displayName: string;
};

type FacetSchemaColumn = {
  key: string;
  displayName: string;
  type: FacetColumnType;
  values?: FacetSchemaValue[];
};

export type FacetSchemaFile = {
  columns: FacetSchemaColumn[];
};

type ScanFileHandler = (path: string) => Promise<ScanFileResult>;

const SUPPORTED_EXTENSIONS = new Set(['.otf', '.ttf', '.ttc', '.otc', '.woff', '.woff2']);
const INSTALLABLE_EXTENSIONS = new Set(['.otf', '.ttf', '.ttc', '.otc']);
const PREVIEWABLE_EXTENSIONS = new Set(['.otf', '.ttf', '.ttc', '.otc', '.woff', '.woff2']);

const normalizeFamilyKey = (value: string) => value.trim().toLowerCase();

const walkDirectory = async (dir: string, results: string[] = []): Promise<string[]> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDirectory(fullPath, results);
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
};

export class LibraryStore {
  private db: Database.Database;

  constructor(private libraryRoot: string) {
    const dbPath = join(libraryRoot, 'db.sqlite');
    this.db = new Database(dbPath);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');
    this.initializeSchema();
  }

  private initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS library_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS font_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER NOT NULL,
        path TEXT NOT NULL UNIQUE,
        ext TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        last_seen_at TEXT NOT NULL,
        status TEXT NOT NULL,
        FOREIGN KEY(source_id) REFERENCES sources(id)
      );

      CREATE TABLE IF NOT EXISTS families (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        family_key TEXT NOT NULL UNIQUE,
        family_name_display TEXT NOT NULL,
        foundry_nullable TEXT,
        preferred_sort_name_nullable TEXT
      );

      CREATE TABLE IF NOT EXISTS faces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        family_id INTEGER NOT NULL,
        file_id INTEGER NOT NULL,
        index_in_collection INTEGER NOT NULL,
        postscript_name TEXT NOT NULL,
        full_name TEXT NOT NULL,
        style_name TEXT NOT NULL,
        weight REAL,
        width REAL,
        slant REAL,
        is_italic INTEGER NOT NULL,
        is_variable INTEGER NOT NULL,
        axes_json TEXT,
        activated_bool INTEGER NOT NULL DEFAULT 0,
        preview_supported_bool INTEGER NOT NULL,
        install_supported_bool INTEGER NOT NULL,
        FOREIGN KEY(family_id) REFERENCES families(id),
        FOREIGN KEY(file_id) REFERENCES font_files(id)
      );

      CREATE INDEX IF NOT EXISTS idx_families_name ON families(family_name_display);
      CREATE INDEX IF NOT EXISTS idx_font_files_path ON font_files(path);
      CREATE INDEX IF NOT EXISTS idx_faces_full_name ON faces(full_name);
      CREATE INDEX IF NOT EXISTS idx_faces_postscript ON faces(postscript_name);

      CREATE TABLE IF NOT EXISTS facet_columns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        type TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS facet_values (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        column_id INTEGER NOT NULL,
        value_key TEXT NOT NULL,
        display_name TEXT NOT NULL,
        FOREIGN KEY(column_id) REFERENCES facet_columns(id) ON DELETE CASCADE,
        UNIQUE(column_id, value_key)
      );

      CREATE TABLE IF NOT EXISTS family_facet_values (
        family_id INTEGER NOT NULL,
        value_id INTEGER NOT NULL,
        PRIMARY KEY (family_id, value_id),
        FOREIGN KEY(family_id) REFERENCES families(id) ON DELETE CASCADE,
        FOREIGN KEY(value_id) REFERENCES facet_values(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_family_facet_family ON family_facet_values(family_id);
      CREATE INDEX IF NOT EXISTS idx_family_facet_value ON family_facet_values(value_id);
    `);
  }

  syncFacetSchema(schema: FacetSchemaFile) {
    const columnKeys = new Set(schema.columns.map((column) => column.key));
    const existingColumns = this.db
      .prepare(`SELECT id, key FROM facet_columns`)
      .all() as { id: number; key: string }[];
    const deleteKeys = existingColumns.filter((column) => !columnKeys.has(column.key)).map((column) => column.key);
    if (deleteKeys.length > 0) {
      const placeholders = deleteKeys.map(() => '?').join(', ');
      this.db.prepare(`DELETE FROM facet_columns WHERE key IN (${placeholders})`).run(...deleteKeys);
    }
    for (const column of schema.columns) {
      this.db
        .prepare(
          `INSERT INTO facet_columns (key, display_name, type)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             display_name = excluded.display_name,
             type = excluded.type`,
        )
        .run(column.key, column.displayName, column.type);
      const columnRow = this.db
        .prepare('SELECT id FROM facet_columns WHERE key = ?')
        .get(column.key) as { id: number };
      const columnId = columnRow.id;
      const values = column.values ?? [];
      const normalizedValues =
        column.type === 'boolean' && values.length === 0
          ? [{ key: 'true', displayName: column.displayName }]
          : values;
      const valueKeys = new Set(normalizedValues.map((value) => value.key));
      const existingValues = this.db
        .prepare('SELECT id, value_key as valueKey FROM facet_values WHERE column_id = ?')
        .all(columnId) as { id: number; valueKey: string }[];
      const valuesToDelete = existingValues.filter((value) => !valueKeys.has(value.valueKey));
      if (valuesToDelete.length > 0) {
        const placeholders = valuesToDelete.map(() => '?').join(', ');
        this.db
          .prepare(`DELETE FROM facet_values WHERE id IN (${placeholders})`)
          .run(...valuesToDelete.map((value) => value.id));
      }
      for (const value of normalizedValues) {
        this.db
          .prepare(
            `INSERT INTO facet_values (column_id, value_key, display_name)
             VALUES (?, ?, ?)
             ON CONFLICT(column_id, value_key) DO UPDATE SET
               display_name = excluded.display_name`,
          )
          .run(columnId, value.key, value.displayName);
      }
    }
  }

  listFacetColumns(): FacetColumn[] {
    const columns = this.db
      .prepare(
        `SELECT id, key, display_name as displayName, type
         FROM facet_columns
         ORDER BY display_name`,
      )
      .all() as { id: number; key: string; displayName: string; type: FacetColumnType }[];
    const values = this.db
      .prepare(
        `SELECT id, column_id as columnId, value_key as valueKey, display_name as displayName
         FROM facet_values
         ORDER BY display_name`,
      )
      .all() as { id: number; columnId: number; valueKey: string; displayName: string }[];
    const valuesByColumn = new Map<number, FacetColumn['values']>();
    for (const value of values) {
      const list = valuesByColumn.get(value.columnId) ?? [];
      list.push(value);
      valuesByColumn.set(value.columnId, list);
    }
    return columns.map((column) => ({
      ...column,
      values: valuesByColumn.get(column.id) ?? [],
    }));
  }

  listSources(): LibrarySource[] {
    const rows = this.db
      .prepare(
        `SELECT id, path, is_enabled as isEnabled, created_at as createdAt
         FROM sources
         ORDER BY created_at DESC`,
      )
      .all() as LibrarySource[];
    return rows;
  }

  addSource(path: string): LibrarySource {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO sources (path, is_enabled, created_at)
         VALUES (?, 1, ?)
         ON CONFLICT(path) DO UPDATE SET is_enabled = 1`,
      )
      .run(path, now);
    const row = this.db
      .prepare(
        `SELECT id, path, is_enabled as isEnabled, created_at as createdAt
         FROM sources WHERE path = ?`,
      )
      .get(path) as LibrarySource;
    return row;
  }

  removeSource(id: number) {
    this.db.prepare('DELETE FROM sources WHERE id = ?').run(id);
  }

  private listSourcesRaw(): { id: number; path: string; isEnabled: number }[] {
    return this.db
      .prepare(`SELECT id, path, is_enabled as isEnabled FROM sources WHERE is_enabled = 1`)
      .all() as { id: number; path: string; isEnabled: number }[];
  }

  findSourceForPath(filePath: string): { id: number; path: string } | null {
    const sources = this.listSourcesRaw();
    let bestMatch: { id: number; path: string } | null = null;
    for (const source of sources) {
      if (filePath.startsWith(source.path)) {
        if (!bestMatch || source.path.length > bestMatch.path.length) {
          bestMatch = { id: source.id, path: source.path };
        }
      }
    }
    return bestMatch;
  }

  private upsertScanResult(
    filePath: string,
    sourceId: number,
    ext: string,
    stats: { size: number; mtimeMs: number },
    scanResult: ScanFileResult,
  ) {
    const lastSeenAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO font_files (source_id, path, ext, file_size, mtime, last_seen_at, status)
         VALUES (?, ?, ?, ?, ?, ?, 'ok')
         ON CONFLICT(path) DO UPDATE SET
           source_id = excluded.source_id,
           ext = excluded.ext,
           file_size = excluded.file_size,
           mtime = excluded.mtime,
           last_seen_at = excluded.last_seen_at,
           status = 'ok'`,
      )
      .run(sourceId, filePath, ext, stats.size, stats.mtimeMs, lastSeenAt);
    const fileRow = this.db.prepare('SELECT id FROM font_files WHERE path = ?').get(filePath) as {
      id: number;
    };
    this.db.prepare('DELETE FROM faces WHERE file_id = ?').run(fileRow.id);
    for (const face of scanResult.faces) {
      const familyKey = normalizeFamilyKey(face.familyName);
      this.db
        .prepare(
          `INSERT INTO families (family_key, family_name_display)
           VALUES (?, ?)
           ON CONFLICT(family_key) DO UPDATE SET family_name_display = excluded.family_name_display`,
        )
        .run(familyKey, face.familyName);
      const familyRow = this.db.prepare('SELECT id FROM families WHERE family_key = ?').get(familyKey) as {
        id: number;
      };
      const previewSupported = PREVIEWABLE_EXTENSIONS.has(ext) ? 1 : 0;
      const installSupported = INSTALLABLE_EXTENSIONS.has(ext) ? 1 : 0;
      this.db
        .prepare(
          `INSERT INTO faces (
            family_id,
            file_id,
            index_in_collection,
            postscript_name,
            full_name,
            style_name,
            weight,
            width,
            slant,
            is_italic,
            is_variable,
            axes_json,
            preview_supported_bool,
            install_supported_bool
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          familyRow.id,
          fileRow.id,
          face.index,
          face.postScriptName,
          face.fullName,
          face.styleName,
          face.weight ?? null,
          face.width ?? null,
          face.slant ?? null,
          face.isItalic ? 1 : 0,
          face.isVariable ? 1 : 0,
          null,
          previewSupported,
          installSupported,
        );
    }
  }

  markFileMissing(filePath: string): boolean {
    const fileRow = this.db.prepare('SELECT id FROM font_files WHERE path = ?').get(filePath) as
      | { id: number }
      | undefined;
    if (!fileRow) {
      return false;
    }
    const now = new Date().toISOString();
    this.db
      .prepare(`UPDATE font_files SET status = 'missing', last_seen_at = ? WHERE id = ?`)
      .run(now, fileRow.id);
    this.db.prepare('UPDATE faces SET activated_bool = 0 WHERE file_id = ?').run(fileRow.id);
    return true;
  }

  markMissingUnderPath(pathPrefix: string): string[] {
    const rows = this.db
      .prepare(`SELECT id, path FROM font_files WHERE path LIKE ? AND status != 'missing'`)
      .all(`${pathPrefix}%`) as { id: number; path: string }[];
    if (rows.length === 0) {
      return [];
    }
    const now = new Date().toISOString();
    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => '?').join(', ');
    this.db
      .prepare(`UPDATE font_files SET status = 'missing', last_seen_at = ? WHERE id IN (${placeholders})`)
      .run(now, ...ids);
    this.db.prepare(`UPDATE faces SET activated_bool = 0 WHERE file_id IN (${placeholders})`).run(...ids);
    return rows.map((row) => row.path);
  }

  async scanFilePath(
    filePath: string,
    scanFile: ScanFileHandler,
  ): Promise<{ scanned: number; missingPaths: string[] }> {
    const ext = extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      return { scanned: 0, missingPaths: [] };
    }
    const source = this.findSourceForPath(filePath);
    if (!source) {
      return { scanned: 0, missingPaths: [] };
    }
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        return { scanned: 0, missingPaths: [] };
      }
      const scanResult = await scanFile(filePath);
      this.upsertScanResult(filePath, source.id, ext, stats, scanResult);
      return { scanned: 1, missingPaths: [] };
    } catch {
      const missing = this.markFileMissing(filePath);
      return { scanned: 0, missingPaths: missing ? [filePath] : [] };
    }
  }

  async scanSource(
    sourceId: number,
    scanFile: ScanFileHandler,
  ): Promise<{ scanned: number; missingPaths: string[] }> {
    const source = this.db.prepare('SELECT id, path FROM sources WHERE id = ?').get(sourceId) as
      | { id: number; path: string }
      | undefined;
    if (!source) {
      return { scanned: 0, missingPaths: [] };
    }
    const scanStartedAt = new Date().toISOString();
    const files = await walkDirectory(source.path);
    let scanned = 0;
    for (const filePath of files) {
      const ext = extname(filePath).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        continue;
      }
      const stats = await fs.stat(filePath);
      let scanResult: ScanFileResult | null = null;
      try {
        scanResult = await scanFile(filePath);
      } catch {
        this.db
          .prepare(
            `INSERT INTO font_files (source_id, path, ext, file_size, mtime, last_seen_at, status)
             VALUES (?, ?, ?, ?, ?, ?, 'error')
             ON CONFLICT(path) DO UPDATE SET
               source_id = excluded.source_id,
               ext = excluded.ext,
               file_size = excluded.file_size,
               mtime = excluded.mtime,
               last_seen_at = excluded.last_seen_at,
               status = 'error'`,
          )
          .run(source.id, filePath, ext, stats.size, stats.mtimeMs, new Date().toISOString());
        scanned += 1;
        continue;
      }
      this.upsertScanResult(filePath, source.id, ext, stats, scanResult);
      scanned += 1;
    }
    const missingRows = this.db
      .prepare(
        `SELECT id, path FROM font_files
         WHERE source_id = ? AND last_seen_at < ? AND status != 'missing'`,
      )
      .all(source.id, scanStartedAt) as { id: number; path: string }[];
    if (missingRows.length > 0) {
      const ids = missingRows.map((row) => row.id);
      const placeholders = ids.map(() => '?').join(', ');
      const now = new Date().toISOString();
      this.db
        .prepare(`UPDATE font_files SET status = 'missing', last_seen_at = ? WHERE id IN (${placeholders})`)
        .run(now, ...ids);
      this.db.prepare(`UPDATE faces SET activated_bool = 0 WHERE file_id IN (${placeholders})`).run(...ids);
    }
    return { scanned, missingPaths: missingRows.map((row) => row.path) };
  }

  listFamilies(): LibraryFamily[] {
    const familyRows = this.db
      .prepare(`SELECT id, family_name_display as familyName FROM families ORDER BY family_name_display`)
      .all() as { id: number; familyName: string }[];
    const facetRows = this.db
      .prepare(`SELECT family_id as familyId, value_id as valueId FROM family_facet_values`)
      .all() as { familyId: number; valueId: number }[];
    const facetMap = new Map<number, number[]>();
    for (const row of facetRows) {
      const list = facetMap.get(row.familyId) ?? [];
      list.push(row.valueId);
      facetMap.set(row.familyId, list);
    }
    const faceRows = this.db
      .prepare(
        `SELECT
           faces.id,
           faces.family_id as familyId,
           faces.file_id as fileId,
           font_files.path as filePath,
           faces.index_in_collection as indexInCollection,
           faces.postscript_name as postscriptName,
           faces.full_name as fullName,
           faces.style_name as styleName,
           faces.weight,
           faces.width,
           faces.slant,
           faces.is_italic as isItalic,
          faces.is_variable as isVariable,
          faces.preview_supported_bool as previewSupported,
          faces.install_supported_bool as installSupported,
          faces.activated_bool as activated
         FROM faces
         JOIN font_files ON font_files.id = faces.file_id
         ORDER BY faces.family_id, faces.weight, faces.width, faces.slant`,
      )
      .all() as LibraryFace[];
    const facesByFamily = new Map<number, LibraryFace[]>();
    for (const face of faceRows) {
      const list = facesByFamily.get(face.familyId) ?? [];
      list.push({
        ...face,
        isItalic: Boolean(face.isItalic),
        isVariable: Boolean(face.isVariable),
        previewSupported: Boolean(face.previewSupported),
        installSupported: Boolean(face.installSupported),
        activated: Boolean(face.activated),
      });
      facesByFamily.set(face.familyId, list);
    }
    return familyRows.map((family) => ({
      id: family.id,
      familyName: family.familyName,
      faces: facesByFamily.get(family.id) ?? [],
      facetValueIds: facetMap.get(family.id) ?? [],
    }));
  }

  setFamilyFacetValues(familyId: number, valueIds: number[]) {
    this.db.prepare('DELETE FROM family_facet_values WHERE family_id = ?').run(familyId);
    const uniqueValueIds = Array.from(new Set(valueIds));
    if (uniqueValueIds.length === 0) {
      return;
    }
    const insert = this.db.prepare(
      'INSERT INTO family_facet_values (family_id, value_id) VALUES (?, ?)',
    );
    for (const valueId of uniqueValueIds) {
      insert.run(familyId, valueId);
    }
  }

  setFaceActivated(
    faceId: number,
    activated: boolean,
  ): {
    filePath: string;
    installSupported: boolean;
    shouldRegister: boolean;
    shouldUnregister: boolean;
    activated: boolean;
  } | null {
    const faceRow = this.db
      .prepare(
        `SELECT
           faces.file_id as fileId,
           faces.install_supported_bool as installSupported,
           font_files.path as filePath,
           font_files.status as status
         FROM faces
         JOIN font_files ON font_files.id = faces.file_id
         WHERE faces.id = ?`,
      )
      .get(faceId) as
      | { fileId: number; installSupported: number; filePath: string; status: string }
      | undefined;
    if (!faceRow) {
      return null;
    }
    if (!faceRow.installSupported || faceRow.status !== 'ok') {
      this.db.prepare('UPDATE faces SET activated_bool = 0 WHERE id = ?').run(faceId);
      return {
        filePath: faceRow.filePath,
        installSupported: Boolean(faceRow.installSupported),
        shouldRegister: false,
        shouldUnregister: false,
        activated: false,
      };
    }
    this.db.prepare('UPDATE faces SET activated_bool = ? WHERE id = ?').run(activated ? 1 : 0, faceId);
    const activeCount = this.db
      .prepare('SELECT COUNT(*) as count FROM faces WHERE file_id = ? AND activated_bool = 1')
      .get(faceRow.fileId) as { count: number };
    const shouldRegister = activated && activeCount.count === 1;
    const shouldUnregister = !activated && activeCount.count === 0;
    return {
      filePath: faceRow.filePath,
      installSupported: true,
      shouldRegister,
      shouldUnregister,
      activated,
    };
  }

  listActivationFiles(): {
    fileId: number;
    filePath: string;
    status: string;
    installSupported: boolean;
    activatedCount: number;
  }[] {
    const rows = this.db
      .prepare(
        `SELECT
           font_files.id as fileId,
           font_files.path as filePath,
           font_files.status as status,
           MAX(faces.install_supported_bool) as installSupported,
           SUM(faces.activated_bool) as activatedCount
         FROM font_files
         JOIN faces ON faces.file_id = font_files.id
         GROUP BY font_files.id`,
      )
      .all() as {
      fileId: number;
      filePath: string;
      status: string;
      installSupported: number;
      activatedCount: number;
    }[];
    return rows.map((row) => ({
      fileId: row.fileId,
      filePath: row.filePath,
      status: row.status,
      installSupported: Boolean(row.installSupported),
      activatedCount: row.activatedCount ?? 0,
    }));
  }
}
