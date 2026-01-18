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
