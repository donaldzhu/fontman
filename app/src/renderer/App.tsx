import { useEffect, useState } from 'react';

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
    };
  }
}

const App = () => {
  const [libraryRoot, setLibraryRoot] = useState<string | null>(null);
  const [pingStatus, setPingStatus] = useState<PingStatus>({ ok: false });
  const [sampleText, setSampleText] = useState('The quick brown fox jumps over the lazy dog');

  const sampleFaces = [
    { id: '1', name: 'Sample Sans' },
    { id: '2', name: 'Sample Serif' },
    { id: '3', name: 'Sample Mono' },
    { id: '4', name: 'Sample Display' },
    { id: '5', name: 'Sample Rounded' },
    { id: '6', name: 'Sample Grotesk' },
  ];

  useEffect(() => {
    window.fontman.getLibraryRoot().then(setLibraryRoot);
  }, []);

  const handleChooseLibrary = async () => {
    const root = await window.fontman.chooseLibraryRoot();
    setLibraryRoot(root);
  };

  const handlePing = async () => {
    try {
      const result = await window.fontman.pingHelper();
      setPingStatus({ ok: result.ok, version: result.version });
    } catch (error) {
      setPingStatus({ ok: false, error: (error as Error).message });
    }
  };

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>Fontman</h1>
          <p>Font library root: {libraryRoot ?? 'Not set'}</p>
        </div>
        <div className="app__actions">
          <button type="button" onClick={handleChooseLibrary}>
            Choose Library Root
          </button>
          <button type="button" onClick={handlePing}>
            Ping Helper
          </button>
        </div>
      </header>
      <section className="app__status">
        <h2>Helper Status</h2>
        {pingStatus.ok ? (
          <p>Connected (version {pingStatus.version})</p>
        ) : (
          <p>{pingStatus.error ?? 'Not connected'}</p>
        )}
      </section>
      <section className="app__controls">
        <label className="app__label" htmlFor="sampleText">
          Sample text
        </label>
        <input
          id="sampleText"
          data-testid="sample-text-input"
          className="app__input"
          value={sampleText}
          onChange={(event) => setSampleText(event.target.value)}
        />
      </section>
      <section className="app__grid" data-testid="font-grid">
        {sampleFaces.map((face) => (
          <article key={face.id} className="app__tile" data-testid="font-tile">
            <header className="app__tile-title">{face.name}</header>
            <div className="app__tile-preview" data-testid="font-preview">
              {sampleText}
            </div>
          </article>
        ))}
      </section>
      <section className="app__next">
        <h2>Milestone 1</h2>
        <ul>
          <li>Library root selection & persistence</li>
          <li>Swift helper ping via JSON-RPC</li>
        </ul>
      </section>
    </div>
  );
};

export default App;
