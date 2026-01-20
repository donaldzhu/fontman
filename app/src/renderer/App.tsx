import { useEffect, useMemo, useState } from 'react'
import FamilyGrid from './components/FamilyGrid'
import type { FamilyGridItem } from './components/FamilyTile'

type PingStatus = {
  ok: boolean
  version?: string
  error?: string
}

declare global {
  interface Window {
    fontman: {
      getLibraryRoot: () => Promise<string | null>
      chooseLibraryRoot: () => Promise<string | null>
      pingHelper: () => Promise<{ ok: true; version: string }>
    }
  }
}

export default function App() {
  const [libraryRoot, setLibraryRoot] = useState<string | null>(null)
  const [pingStatus, setPingStatus] = useState<PingStatus>({ ok: false })

  const [sampleText, setSampleText] = useState<string>('The quick brown fox')
  const [fontSizePx, setFontSizePx] = useState<number>(86)

  useEffect(() => {
    window.fontman.getLibraryRoot().then(setLibraryRoot)
  }, [])

  const handleChooseLibrary = async () => {
    const root = await window.fontman.chooseLibraryRoot()
    setLibraryRoot(root)
  }

  const handlePing = async () => {
    try {
      const result = await window.fontman.pingHelper()
      setPingStatus({ ok: result.ok, version: result.version })
    } catch (error) {
      setPingStatus({ ok: false, error: (error as Error).message })
    }
  }

  const demoFamilies: FamilyGridItem[] = useMemo(
    () => [
      { id: 'system-ui', familyName: 'System UI', faceCount: 6, cssFontFamily: 'system-ui', activation: 'inactive' },
      { id: 'helvetica', familyName: 'Helvetica Neue', faceCount: 18, cssFontFamily: 'Helvetica Neue, Helvetica, Arial, system-ui', activation: 'active' },
      { id: 'courier', familyName: 'Courier New', faceCount: 4, cssFontFamily: 'Courier New, Courier, ui-monospace, SFMono-Regular', activation: 'inactive' },
      { id: 'georgia', familyName: 'Georgia', faceCount: 6, cssFontFamily: 'Georgia, ui-serif, Times New Roman, Times', activation: 'partial' },
      { id: 'times', familyName: 'Times', faceCount: 8, cssFontFamily: 'Times New Roman, Times, ui-serif', activation: 'inactive' },
      { id: 'arial-narrow', familyName: 'Arial Narrow', faceCount: 4, cssFontFamily: 'Arial Narrow, Arial, system-ui', activation: 'inactive' },
    ],
    []
  )

  const setFontSizeFromEvent = (e: React.ChangeEvent<HTMLInputElement> | React.FormEvent<HTMLInputElement>) => {
    const v = Number((e.target as HTMLInputElement).value)
    setFontSizePx(v)
  }

  return (
    <div className="appShell">
      <header className="topBar">
        <div className="topBar__left">
          <div className="brand">
            <div className="brand__title">FONTMAN MVP</div>
            <div className="brand__sub">Library root: {libraryRoot ?? 'Not set'}</div>
          </div>
        </div>

        <div className="topBar__center">
          <label className="control control--text">
            <span className="control__label">Sample</span>
            <input
              value={sampleText}
              onChange={(e) => setSampleText(e.target.value)}
              placeholder="Type preview text…"
            />
          </label>

          <label className="control control--slider">
            <span className="control__label">Size</span>
            <input
              type="range"
              min={16}
              max={200}
              value={fontSizePx}
              onChange={setFontSizeFromEvent}
              onInput={setFontSizeFromEvent as any}  /* Electron: ensure continuous updates while dragging */
            />
            <span className="control__value">{fontSizePx}px</span>
          </label>
        </div>

        <div className="topBar__right">
          <button type="button" onClick={handleChooseLibrary} className="btn">
            Choose Library Root
          </button>
          <button type="button" onClick={handlePing} className="btn btn--ping">
            <span
              className={
                pingStatus.ok
                  ? 'pingDot pingDot--green'
                  : pingStatus.error
                    ? 'pingDot pingDot--red'
                    : 'pingDot pingDot--gray'
              }
            />
            Ping Helper
          </button>
        </div>
      </header>

      <main className="mainStage">
        <FamilyGrid families={demoFamilies} sampleText={sampleText} targetFontSizePx={fontSizePx} />
      </main>

      <footer className="footer">
        <div className="footer__left">
          Helper: {pingStatus.ok ? `Connected (v${pingStatus.version})` : pingStatus.error ?? 'Not connected'}
        </div>
        <div className="footer__right">(This screen is a sizing demo scaffold.)</div>
      </footer>
    </div>
  )
}
