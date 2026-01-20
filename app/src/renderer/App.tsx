import { useCallback, useEffect, useMemo, useState } from 'react'
import FamilyGrid from './components/FamilyGrid'
import type { FamilyGridItem } from './components/FamilyTile'
import type { LibraryFace, LibraryFamily, LibrarySource } from '@fontman/shared/src/protocol'

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
      listSources: () => Promise<LibrarySource[]>
      addSource: () => Promise<LibrarySource | null>
      scanSource: (sourceId: number) => Promise<{ scanned: number; missingPaths: string[] }>
      listFamilies: () => Promise<LibraryFamily[]>
    }
  }
}

const STYLE_PRIORITY = ['regular', 'book', 'medium', 'roman', 'normal']

const resolveStyleRank = (face: LibraryFace) => {
  const styleName = face.styleName?.toLowerCase() ?? ''
  const index = STYLE_PRIORITY.findIndex((style) => styleName.includes(style))
  return index === -1 ? STYLE_PRIORITY.length : index
}

const chooseRepresentativeFace = (faces: LibraryFace[]) => {
  if (!faces.length) {
    return null
  }
  const sorted = [...faces].sort((a, b) => {
    const styleRankA = resolveStyleRank(a)
    const styleRankB = resolveStyleRank(b)
    if (styleRankA !== styleRankB) {
      return styleRankA - styleRankB
    }
    if (a.isItalic !== b.isItalic) {
      return a.isItalic ? 1 : -1
    }
    const weightA = a.weight ?? 400
    const weightB = b.weight ?? 400
    if (weightA !== weightB) {
      return weightA - weightB
    }
    const widthA = a.width ?? 0
    const widthB = b.width ?? 0
    if (widthA !== widthB) {
      return widthA - widthB
    }
    if (a.isItalic !== b.isItalic) {
      return a.isItalic ? 1 : -1
    }
    return a.id - b.id
  })
  return sorted[0]
}

const resolveActivationState = (faces: LibraryFace[]) => {
  const activatable = faces.filter((face) => face.installSupported)
  if (activatable.length === 0) {
    return 'inactive'
  }
  const activeCount = activatable.filter((face) => face.activated).length
  if (activeCount === 0) {
    return 'inactive'
  }
  if (activeCount === activatable.length) {
    return 'active'
  }
  return 'partial'
}

export default function App() {
  const [libraryRoot, setLibraryRoot] = useState<string | null>(null)
  const [pingStatus, setPingStatus] = useState<PingStatus>({ ok: false })
  const [sources, setSources] = useState<LibrarySource[]>([])
  const [families, setFamilies] = useState<LibraryFamily[]>([])

  const [sampleText, setSampleText] = useState<string>('The quick brown fox')
  const [fontSizePx, setFontSizePx] = useState<number>(86)

  const refreshData = useCallback(async () => {
    const root = await window.fontman.getLibraryRoot()
    setLibraryRoot(root)
    const [sourceRows, familyRows] = await Promise.all([
      window.fontman.listSources(),
      window.fontman.listFamilies(),
    ])
    setSources(sourceRows)
    setFamilies(familyRows)
  }, [])

  const refreshFamilies = useCallback(async () => {
    const familyRows = await window.fontman.listFamilies()
    setFamilies(familyRows)
  }, [])

  const refreshSources = useCallback(async () => {
    const sourceRows = await window.fontman.listSources()
    setSources(sourceRows)
  }, [])

  useEffect(() => {
    void refreshData()
  }, [refreshData])

  const handleChooseLibrary = async () => {
    const root = await window.fontman.chooseLibraryRoot()
    setLibraryRoot(root)
    await refreshSources()
    await refreshFamilies()
  }

  const handlePing = async () => {
    try {
      const result = await window.fontman.pingHelper()
      setPingStatus({ ok: result.ok, version: result.version })
    } catch (error) {
      setPingStatus({ ok: false, error: (error as Error).message })
    }
  }

  const handleAddSource = async () => {
    const source = await window.fontman.addSource()
    if (source) {
      await refreshSources()
      await refreshFamilies()
    }
  }

  const handleRescanSource = async (sourceId: number) => {
    await window.fontman.scanSource(sourceId)
    await refreshFamilies()
  }

  const gridFamilies: FamilyGridItem[] = useMemo(
    () =>
      families.map((family) => {
        const representative = chooseRepresentativeFace(family.faces)
        const activation = resolveActivationState(family.faces)
        const previewFamilyName = representative ? `face_${representative.id}` : family.familyName
        const previewFont =
          representative && representative.previewSupported
            ? {
                id: String(representative.id),
                family: previewFamilyName,
                sourceUrl: `fontman://font?path=${encodeURIComponent(representative.filePath)}`,
                weight: representative.weight ? String(representative.weight) : undefined,
                style: representative.isItalic ? 'italic' : 'normal',
              }
            : undefined
        return {
          id: String(family.id),
          familyName: family.familyName,
          faceCount: family.faces.length,
          cssFontFamily: previewFont ? previewFamilyName : 'system-ui',
          previewFont,
          activation,
        }
      }),
    [families],
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
        <div className="contentLayout">
          <aside className="sidebar">
            <div className="sidebarSection">
              <div className="sidebarSection__header">
                <h3 className="sidebarSection__title">Sources</h3>
                <button type="button" className="btn btn--compact" onClick={handleAddSource}>
                  Add Source
                </button>
              </div>
              <div className="sourceList">
                {sources.length === 0 ? (
                  <div className="sourceList__empty">No sources yet. Add a folder to scan fonts.</div>
                ) : (
                  sources.map((source) => (
                    <div key={source.id} className="sourceRow">
                      <div className="sourceRow__path" title={source.path}>
                        {source.path}
                      </div>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => handleRescanSource(source.id)}
                      >
                        Rescan
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>

          <FamilyGrid families={gridFamilies} sampleText={sampleText} targetFontSizePx={fontSizePx} />
        </div>
      </main>

      <footer className="footer">
        <div className="footer__left">
          Helper: {pingStatus.ok ? `Connected (v${pingStatus.version})` : pingStatus.error ?? 'Not connected'}
        </div>
      </footer>
    </div>
  )
}
