import Database from 'better-sqlite3';
import { promises as fs } from 'node:fs';
import { join, extname } from 'node:path';
import type { LibraryFamily, LibraryFace, LibrarySource, ScanFileResult } from '@fontman/shared/src/protocol';

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
    `);
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
           faces.install_supported_bool as installSupported
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
      });
      facesByFamily.set(face.familyId, list);
    }
    return familyRows.map((family) => ({
      id: family.id,
      familyName: family.familyName,
      faces: facesByFamily.get(family.id) ?? [],
    }));
  }
}
