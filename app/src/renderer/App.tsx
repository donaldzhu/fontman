import { useEffect, useMemo, useState } from 'react';
import type { LibraryFamily, LibraryFace, LibrarySource } from '@fontman/shared/src/protocol';

type PingStatus = {
  ok: boolean;
  version?: string;
  error?: string;
};

declare global {
  interface Window {
    fontman: {
      getLibraryRoot: () => Promise<string | null>;
      chooseLibraryRoot: () => Promise<string | null>;
      pingHelper: () => Promise<{ ok: true; version: string }>;
      listSources: () => Promise<LibrarySource[]>;
      addSource: () => Promise<LibrarySource | null>;
      scanSource: (sourceId: number) => Promise<{ scanned: number }>;
      listFamilies: () => Promise<LibraryFamily[]>;
    };
  }
}

const buildFontFaceRule = (face: LibraryFace) => {
  const src = `fontman://font?path=${encodeURIComponent(face.filePath)}`;
  return `
    @font-face {
      font-family: "face_${face.id}";
      src: url("${src}");
      font-display: swap;
    }
  `;
};

const App = () => {
  const [libraryRoot, setLibraryRoot] = useState<string | null>(null);
  const [pingStatus, setPingStatus] = useState<PingStatus>({ ok: false });
  const [sources, setSources] = useState<LibrarySource[]>([]);
  const [families, setFamilies] = useState<LibraryFamily[]>([]);
  const [sampleText, setSampleText] = useState('The quick brown fox jumps over the lazy dog.');
  const [fontSize, setFontSize] = useState(26);
  const [isScanning, setIsScanning] = useState(false);

  const refreshSources = async () => {
    const data = await window.fontman.listSources();
    setSources(data);
  };

  const refreshFamilies = async () => {
    const data = await window.fontman.listFamilies();
    setFamilies(data);
  };

  useEffect(() => {
    window.fontman.getLibraryRoot().then(setLibraryRoot);
    refreshSources();
    refreshFamilies();
  }, []);

  const handleChooseLibrary = async () => {
    const root = await window.fontman.chooseLibraryRoot();
    setLibraryRoot(root);
    await refreshSources();
    await refreshFamilies();
  };

  const handlePing = async () => {
    try {
      const result = await window.fontman.pingHelper();
      setPingStatus({ ok: result.ok, version: result.version });
    } catch (error) {
      setPingStatus({ ok: false, error: (error as Error).message });
    }
  };

  const handleAddSource = async () => {
    setIsScanning(true);
    await window.fontman.addSource();
    await refreshSources();
    await refreshFamilies();
    setIsScanning(false);
  };

  const handleScanSource = async (sourceId: number) => {
    setIsScanning(true);
    await window.fontman.scanSource(sourceId);
    await refreshFamilies();
    setIsScanning(false);
  };

  const fontFaceStyles = useMemo(() => {
    const faces = families.flatMap((family) => family.faces);
    return faces.map(buildFontFaceRule).join('\n');
  }, [families]);

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <p className="app__kicker">Fontman MVP</p>
          <h1>Library</h1>
          <p className="app__subtle">Library root: {libraryRoot ?? 'Not set'}</p>
        </div>
        <div className="app__actions">
          <button type="button" onClick={handleChooseLibrary}>
            Choose Library Root
          </button>
          <button type="button" onClick={handleAddSource} disabled={isScanning}>
            {isScanning ? 'Scanning…' : 'Add Source'}
          </button>
          <button type="button" onClick={handlePing}>
            Ping Helper
          </button>
        </div>
      </header>

      <div className="app__layout">
        <aside className="sidebar">
          <h2>Sources</h2>
          <ul className="sidebar__list">
            {sources.map((source) => (
              <li key={source.id} className="sidebar__item">
                <div>
                  <p className="sidebar__path">{source.path}</p>
                  <p className="sidebar__meta">Added {new Date(source.createdAt).toLocaleString()}</p>
                </div>
                <button type="button" onClick={() => handleScanSource(source.id)} disabled={isScanning}>
                  Rescan
                </button>
              </li>
            ))}
          </ul>
          {sources.length === 0 && <p className="sidebar__empty">No sources yet.</p>}
          <div className="sidebar__status">
            <h3>Helper Status</h3>
            {pingStatus.ok ? (
              <p>Connected (version {pingStatus.version})</p>
            ) : (
              <p>{pingStatus.error ?? 'Not connected'}</p>
            )}
          </div>
        </aside>

        <main className="content">
          <div className="content__toolbar">
            <label className="content__label">
              Sample text
              <input
                type="text"
                value={sampleText}
                onChange={(event) => setSampleText(event.target.value)}
              />
            </label>
            <label className="content__label">
              Size
              <input
                type="range"
                min={12}
                max={72}
                value={fontSize}
                onChange={(event) => setFontSize(Number(event.target.value))}
              />
              <span>{fontSize}px</span>
            </label>
          </div>

          <style>{fontFaceStyles}</style>

          <section className="family-grid">
            {families.map((family) => (
              <div key={family.id} className="family-card">
                <div className="family-card__header">
                  <h2>{family.familyName}</h2>
                  <span>{family.faces.length} faces</span>
                </div>
                <div className="family-card__faces">
                  {family.faces.map((face) => (
                    <div key={face.id} className="face-tile">
                      <p className="face-tile__name">{face.fullName}</p>
                      <p className="face-tile__style">{face.styleName}</p>
                      <div
                        className="face-tile__preview"
                        style={{ fontFamily: `face_${face.id}`, fontSize }}
                      >
                        {sampleText}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {families.length === 0 && (
              <div className="content__empty">
                <h2>No fonts indexed yet</h2>
                <p>Add a source directory to start scanning.</p>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
};

export default App;
