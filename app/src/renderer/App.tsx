import { useEffect, useMemo, useState } from 'react'
import type {
  LibraryFamily,
  LibraryFace,
  LibrarySource,
  FacetColumn,
  FaceFeaturesResult,
  FontFeature,
  FontVariationAxis,
} from '@fontman/shared/src/protocol'

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
      scanSource: (sourceId: number) => Promise<{ scanned: number }>
      listFamilies: () => Promise<LibraryFamily[]>
      listFacets: () => Promise<FacetColumn[]>
      getFaceFeatures: (path: string, index: number) => Promise<FaceFeaturesResult>
      renderPreview: (
        path: string,
        index: number,
        text: string,
        size: number,
        features: string[],
        variations: Record<string, number>,
      ) => Promise<{ ok: boolean; pngBase64?: string }>
      setFamilyFacetValues: (familyId: number, valueIds: number[]) => Promise<{ ok: boolean }>
      setFaceActivated: (faceId: number, activated: boolean) => Promise<{ activated: boolean }>
    }
  }
}

type FaceFeaturesState = {
  features: FontFeature[]
  axes: FontVariationAxis[]
}

type FaceSettingsState = {
  featureStates: Record<string, boolean>
  axisValues: Record<string, number>
}

const buildFontFaceRule = (face: LibraryFace) => {
  const src = `fontman://font?path=${encodeURIComponent(face.filePath)}`
  return `
    @font-face {
      font-family: "face_${face.id}";
      src: url("${src}");
      font-display: swap;
    }
  `
}

const STYLE_PREFERENCE = ['regular', 'book', 'medium', 'roman', 'normal']

const normalizeStyleName = (styleName: string) => styleName.toLowerCase().trim()

const getStyleRank = (styleName: string) => {
  const normalized = normalizeStyleName(styleName)
  const parts = normalized.split(/[\s-_]+/)
  for (let index = 0; index < STYLE_PREFERENCE.length; index += 1) {
    const target = STYLE_PREFERENCE[index]
    if (parts.includes(target) || normalized === target) {
      return index
    }
  }
  return STYLE_PREFERENCE.length
}

const isItalicStyle = (face: LibraryFace) =>
  face.isItalic || normalizeStyleName(face.styleName).includes('italic')

const getRepresentativeFace = (family: LibraryFamily) => {
  const faces = [...family.faces]
  faces.sort((a, b) => {
    const styleRank = getStyleRank(a.styleName) - getStyleRank(b.styleName)
    if (styleRank !== 0) {
      return styleRank
    }
    const italicRank = Number(isItalicStyle(a)) - Number(isItalicStyle(b))
    if (italicRank !== 0) {
      return italicRank
    }
    const weightRank = (a.weight ?? Number.MAX_SAFE_INTEGER) - (b.weight ?? Number.MAX_SAFE_INTEGER)
    if (weightRank !== 0) {
      return weightRank
    }
    const widthRank = (a.width ?? Number.MAX_SAFE_INTEGER) - (b.width ?? Number.MAX_SAFE_INTEGER)
    if (widthRank !== 0) {
      return widthRank
    }
    const italicFallback = Number(isItalicStyle(a)) - Number(isItalicStyle(b))
    if (italicFallback !== 0) {
      return italicFallback
    }
    return a.id - b.id
  })
  return faces[0] ?? null
}

const App = () => {
  const [libraryRoot, setLibraryRoot] = useState<string | null>(null)
  const [pingStatus, setPingStatus] = useState<PingStatus>({ ok: false })
  const [sources, setSources] = useState<LibrarySource[]>([])
  const [families, setFamilies] = useState<LibraryFamily[]>([])
  const [facetColumns, setFacetColumns] = useState<FacetColumn[]>([])
  const [sampleText, setSampleText] = useState('The quick brown fox jumps over the lazy dog.')
  const [fontSize, setFontSize] = useState(26)
  const [isScanning, setIsScanning] = useState(false)
  const [activationUpdate, setActivationUpdate] = useState(false)
  const [selectedFamilyId, setSelectedFamilyId] = useState<number | null>(null)
  const [selectedFaceId, setSelectedFaceId] = useState<number | null>(null)
  const [searchText, setSearchText] = useState('')
  const [openTypePanelOpen, setOpenTypePanelOpen] = useState(false)
  const [faceFeatures, setFaceFeatures] = useState<Record<number, FaceFeaturesState>>({})
  const [faceSettings, setFaceSettings] = useState<Record<number, FaceSettingsState>>({})
  const [previewRenders, setPreviewRenders] = useState<
    Record<number, { key: string; dataUrl: string }>
  >({})
  const [facetFilters, setFacetFilters] = useState<
    Record<
      number,
      | { type: 'multi'; selectedValueIds: number[] }
      | { type: 'single'; selectedValueId: number | null }
      | { type: 'boolean'; state: 'any' | 'yes' | 'no' }
    >
  >({})

  const refreshSources = async () => {
    const data = await window.fontman.listSources()
    setSources(data)
  }

  const refreshFamilies = async () => {
    const data = await window.fontman.listFamilies()
    setFamilies(data)
  }

  const refreshFacets = async () => {
    const data = await window.fontman.listFacets()
    setFacetColumns(data)
  }

  useEffect(() => {
    window.fontman.getLibraryRoot().then(setLibraryRoot)
    refreshSources()
    refreshFamilies()
    refreshFacets()
  }, [])

  useEffect(() => {
    setFacetFilters((current) => {
      const next = { ...current }
      for (const column of facetColumns) {
        if (!next[column.id]) {
          if (column.type === 'multi') {
            next[column.id] = { type: 'multi', selectedValueIds: [] }
          } else if (column.type === 'single') {
            next[column.id] = { type: 'single', selectedValueId: null }
          } else {
            next[column.id] = { type: 'boolean', state: 'any' }
          }
        }
      }
      return next
    })
  }, [facetColumns])

  const handleChooseLibrary = async () => {
    const root = await window.fontman.chooseLibraryRoot()
    setLibraryRoot(root)
    await refreshSources()
    await refreshFamilies()
    await refreshFacets()
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
    setIsScanning(true)
    await window.fontman.addSource()
    await refreshSources()
    await refreshFamilies()
    setIsScanning(false)
  }

  const handleScanSource = async (sourceId: number) => {
    setIsScanning(true)
    await window.fontman.scanSource(sourceId)
    await refreshFamilies()
    setIsScanning(false)
  }

  const handleToggleActivation = async (face: LibraryFace) => {
    setActivationUpdate(true)
    await window.fontman.setFaceActivated(face.id, !face.activated)
    await refreshFamilies()
    setActivationUpdate(false)
  }

  const updateFacetFilter = (
    columnId: number,
    update:
      | { type: 'multi'; selectedValueIds: number[] }
      | { type: 'single'; selectedValueId: number | null }
      | { type: 'boolean'; state: 'any' | 'yes' | 'no' },
  ) => {
    setFacetFilters((current) => ({ ...current, [columnId]: update }))
  }

  const handleToggleFacetFilterValue = (columnId: number, valueId: number) => {
    const filter = facetFilters[columnId]
    if (!filter || filter.type !== 'multi') {
      return
    }
    const selected = filter.selectedValueIds.includes(valueId)
      ? filter.selectedValueIds.filter((id) => id !== valueId)
      : [...filter.selectedValueIds, valueId]
    updateFacetFilter(columnId, { type: 'multi', selectedValueIds: selected })
  }

  const selectedFamily = useMemo(
    () => families.find((family) => family.id === selectedFamilyId) ?? null,
    [families, selectedFamilyId],
  )
  const selectedFace = useMemo(() => {
    if (!selectedFamily || selectedFaceId == null) {
      return null
    }
    return selectedFamily.faces.find((face) => face.id === selectedFaceId) ?? null
  }, [selectedFamily, selectedFaceId])

  const representativeFaces = useMemo(() => {
    const map = new Map<number, LibraryFace>()
    for (const family of families) {
      const representative = getRepresentativeFace(family)
      if (representative) {
        map.set(family.id, representative)
      }
    }
    return map
  }, [families])

  const handleFamilyFacetUpdate = async (familyId: number, valueIds: number[]) => {
    await window.fontman.setFamilyFacetValues(familyId, valueIds)
    await refreshFamilies()
  }

  const handleToggleFamilyFacetValue = async (family: LibraryFamily, column: FacetColumn, valueId: number) => {
    const current = family.facetValueIds
    let next = [...current]
    if (column.type === 'multi') {
      if (next.includes(valueId)) {
        next = next.filter((id) => id !== valueId)
      } else {
        next = [...next, valueId]
      }
    } else {
      next = next.filter((id) => !column.values.some((value) => value.id === id))
      if (!current.includes(valueId)) {
        next.push(valueId)
      }
    }
    await handleFamilyFacetUpdate(family.id, next)
  }

  useEffect(() => {
    if (!selectedFamily) {
      setSelectedFaceId(null)
      return
    }
    const faceIds = selectedFamily.faces.map((face) => face.id)
    if (selectedFaceId == null || !faceIds.includes(selectedFaceId)) {
      const representative = getRepresentativeFace(selectedFamily)
      setSelectedFaceId(representative?.id ?? selectedFamily.faces[0]?.id ?? null)
    }
  }, [selectedFamily, selectedFaceId])

  useEffect(() => {
    if (!selectedFace) {
      return
    }
    void ensureFaceFeatures(selectedFace)
  }, [selectedFace])

  const handleToggleBooleanFacet = async (family: LibraryFamily, column: FacetColumn) => {
    const valueId = column.values[0]?.id
    if (!valueId) {
      return
    }
    const current = family.facetValueIds
    const next = current.includes(valueId) ? current.filter((id) => id !== valueId) : [...current, valueId]
    await handleFamilyFacetUpdate(family.id, next)
  }

  const fontFaceStyles = useMemo(() => {
    const faces = families.flatMap((family) => family.faces)
    return faces.map(buildFontFaceRule).join('\n')
  }, [families])

  const buildFeatureSettings = (faceId: number) => {
    const settings = faceSettings[faceId]
    if (!settings) {
      return undefined
    }
    const enabledEntries = Object.entries(settings.featureStates).filter(([, enabled]) => enabled)
    if (enabledEntries.length === 0) {
      return '"liga" 1'
    }
    return enabledEntries.map(([tag]) => `"${tag}" 1`).join(', ')
  }

  const buildVariationSettings = (faceId: number) => {
    const settings = faceSettings[faceId]
    if (!settings) {
      return undefined
    }
    const entries = Object.entries(settings.axisValues)
    if (entries.length === 0) {
      return undefined
    }
    return entries.map(([tag, value]) => `"${tag}" ${value}`).join(', ')
  }

  const ensureFaceFeatures = async (face: LibraryFace): Promise<FaceFeaturesState> => {
    if (faceFeatures[face.id]) {
      return faceFeatures[face.id]
    }
    const result = await window.fontman.getFaceFeatures(face.filePath, face.indexInCollection)
    const nextFeatures = { features: result.features, axes: result.axes }
    setFaceFeatures((current) => ({
      ...current,
      [face.id]: nextFeatures,
    }))
    setFaceSettings((current) => {
      if (current[face.id]) {
        return current
      }
      const featureStates: Record<string, boolean> = {}
      for (const feature of result.features) {
        featureStates[feature.tag] = feature.enabledByDefault
      }
      const axisValues: Record<string, number> = {}
      for (const axis of result.axes) {
        axisValues[axis.tag] = axis.defaultValue
      }
      return {
        ...current,
        [face.id]: {
          featureStates,
          axisValues,
        },
      }
    })
    return nextFeatures
  }

  const isCollectionFace = (face: LibraryFace) => {
    const extension = face.filePath.split('.').pop()?.toLowerCase()
    return extension === 'ttc' || extension === 'otc'
  }

  const getEnabledFeatureTags = (faceId: number, featureData?: FaceFeaturesState) => {
    const settings = faceSettings[faceId]
    if (settings) {
      return Object.entries(settings.featureStates)
        .filter(([, enabled]) => enabled)
        .map(([tag]) => tag)
        .sort()
    }
    const fallback = featureData?.features ?? []
    return fallback.filter((feature) => feature.enabledByDefault).map((feature) => feature.tag).sort()
  }

  const getAxisValues = (faceId: number, featureData?: FaceFeaturesState) => {
    const settings = faceSettings[faceId]
    if (settings) {
      return settings.axisValues
    }
    const axisDefaults: Record<string, number> = {}
    for (const axis of featureData?.axes ?? []) {
      axisDefaults[axis.tag] = axis.defaultValue
    }
    return axisDefaults
  }

  const buildPreviewKey = (faceId: number, featureData?: FaceFeaturesState) => {
    const enabledFeatures = getEnabledFeatureTags(faceId, featureData)
    const axisValues = getAxisValues(faceId, featureData)
    const axisEntries = Object.entries(axisValues)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tag, value]) => `${tag}:${value}`)
      .join(',')
    return `${faceId}|${fontSize}|${sampleText}|${enabledFeatures.join(',')}|${axisEntries}`
  }

  const filteredFamilies = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase()
    return families.filter((family) => {
      if (normalizedSearch) {
        const familyMatch = family.familyName.toLowerCase().includes(normalizedSearch)
        const faceMatch = family.faces.some((face) =>
          `${face.fullName} ${face.styleName}`.toLowerCase().includes(normalizedSearch),
        )
        if (!familyMatch && !faceMatch) {
          return false
        }
      }
      for (const column of facetColumns) {
        const filter = facetFilters[column.id]
        if (!filter) {
          continue
        }
        if (column.type === 'multi' && filter.type === 'multi') {
          if (filter.selectedValueIds.length === 0) {
            continue
          }
          const matches = filter.selectedValueIds.some((id) => family.facetValueIds.includes(id))
          if (!matches) {
            return false
          }
        } else if (column.type === 'single' && filter.type === 'single') {
          if (filter.selectedValueId == null) {
            continue
          }
          if (!family.facetValueIds.includes(filter.selectedValueId)) {
            return false
          }
        } else if (column.type === 'boolean' && filter.type === 'boolean') {
          const valueId = column.values[0]?.id
          if (!valueId || filter.state === 'any') {
            continue
          }
          const hasValue = family.facetValueIds.includes(valueId)
          if (filter.state === 'yes' && !hasValue) {
            return false
          }
          if (filter.state === 'no' && hasValue) {
            return false
          }
        }
      }
      return true
    })
  }, [families, facetColumns, facetFilters, searchText])


  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const faces = filteredFamilies
        .map((family) => representativeFaces.get(family.id))
        .filter((face): face is LibraryFace => Boolean(face))
      for (const face of faces) {
        if (!isCollectionFace(face) || !face.previewSupported) {
          continue
        }
        const featureData = await ensureFaceFeatures(face)
        if (cancelled) {
          return
        }
        const enabledFeatures = getEnabledFeatureTags(face.id, featureData)
        const axisValues = getAxisValues(face.id, featureData)
        const previewKey = buildPreviewKey(face.id, featureData)
        const cached = previewRenders[face.id]
        if (cached?.key === previewKey) {
          continue
        }
        const result = await window.fontman.renderPreview(
          face.filePath,
          face.indexInCollection,
          sampleText,
          fontSize,
          enabledFeatures,
          axisValues,
        )
        if (cancelled) {
          return
        }
        if (result.ok && result.pngBase64) {
          const dataUrl = `data:image/png;base64,${result.pngBase64}`
          setPreviewRenders((current) => ({
            ...current,
            [face.id]: { key: previewKey, dataUrl },
          }))
        }
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [filteredFamilies, sampleText, fontSize, faceSettings, faceFeatures, previewRenders, representativeFaces])

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
          <button type="button" onClick={handlePing}>
            Ping Helper
          </button>
        </div>
      </header>

      <div className="app__layout">
        <aside className="sidebar">
          <div className="sidebar__section sidebar__section--sources">
            <div className="sidebar__section-header">
              <h2>Sources</h2>
              <button type="button" onClick={handleAddSource} disabled={isScanning}>
                {isScanning ? 'Scanning…' : 'Add Source'}
              </button>
            </div>
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
          </div>
          <div className="sidebar__status">
            <h3>Helper Status</h3>
            {pingStatus.ok ? (
              <p>Connected (version {pingStatus.version})</p>
            ) : (
              <p>{pingStatus.error ?? 'Not connected'}</p>
            )}
          </div>
          <div className="sidebar__section">
            <h3>Facet Filters</h3>
            {facetColumns.length === 0 && <p className="sidebar__empty">No facet schema yet.</p>}
            {facetColumns.map((column) => {
              const filter = facetFilters[column.id]
              if (column.type === 'multi' && filter?.type === 'multi') {
                return (
                  <div key={column.id} className="facet">
                    <p className="facet__title">{column.displayName}</p>
                    <div className="facet__options">
                      {column.values.map((value) => (
                        <label key={value.id} className="facet__option">
                          <input
                            type="checkbox"
                            checked={filter.selectedValueIds.includes(value.id)}
                            onChange={() => handleToggleFacetFilterValue(column.id, value.id)}
                          />
                          {value.displayName}
                        </label>
                      ))}
                    </div>
                  </div>
                )
              }
              if (column.type === 'single' && filter?.type === 'single') {
                return (
                  <div key={column.id} className="facet">
                    <label className="facet__title">
                      {column.displayName}
                      <select
                        value={filter.selectedValueId ?? ''}
                        onChange={(event) =>
                          updateFacetFilter(column.id, {
                            type: 'single',
                            selectedValueId: event.target.value ? Number(event.target.value) : null,
                          })
                        }
                      >
                        <option value="">Any</option>
                        {column.values.map((value) => (
                          <option key={value.id} value={value.id}>
                            {value.displayName}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )
              }
              if (column.type === 'boolean' && filter?.type === 'boolean') {
                return (
                  <div key={column.id} className="facet">
                    <label className="facet__title">
                      {column.displayName}
                      <select
                        value={filter.state}
                        onChange={(event) =>
                          updateFacetFilter(column.id, {
                            type: 'boolean',
                            state: event.target.value as 'any' | 'yes' | 'no',
                          })
                        }
                      >
                        <option value="any">Any</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </label>
                  </div>
                )
              }
              return null
            })}
          </div>
          <div className="sidebar__section">
            <h3>Inspector</h3>
            {!selectedFamily && <p className="sidebar__empty">Select a family to edit tags.</p>}
            {selectedFamily && (
              <div className="inspector">
                <p className="inspector__title">{selectedFamily.familyName}</p>
                <div className="inspector__faces">
                  {selectedFamily.faces.map((face) => (
                    <div key={face.id} className="inspector__face">
                      <span>{face.styleName}</span>
                      <button
                        type="button"
                        className={`inspector__select${selectedFace?.id === face.id ? ' is-active' : ''}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          setSelectedFaceId(face.id)
                          void ensureFaceFeatures(face)
                        }}
                      >
                        {selectedFace?.id === face.id ? 'Selected' : 'Select'}
                      </button>
                      <button
                        type="button"
                        disabled={!face.installSupported || activationUpdate}
                        onClick={(event) => {
                          event.stopPropagation()
                          handleToggleActivation(face)
                        }}
                      >
                        {face.activated ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="inspector__facets">
                  {facetColumns.map((column) => (
                    <div key={column.id} className="facet facet--editor">
                      <p className="facet__title">{column.displayName}</p>
                      {column.type === 'multi' && (
                        <div className="facet__options">
                          {column.values.map((value) => (
                            <label key={value.id} className="facet__option">
                              <input
                                type="checkbox"
                                checked={selectedFamily.facetValueIds.includes(value.id)}
                                onChange={(event) => {
                                  event.stopPropagation()
                                  handleToggleFamilyFacetValue(selectedFamily, column, value.id)
                                }}
                              />
                              {value.displayName}
                            </label>
                          ))}
                        </div>
                      )}
                      {column.type === 'single' && (
                        <div className="facet__options">
                          <label className="facet__option">
                            <input
                              type="radio"
                              name={`facet-${column.id}`}
                              checked={!column.values.some((value) =>
                                selectedFamily.facetValueIds.includes(value.id),
                              )}
                              onChange={(event) => {
                                event.stopPropagation()
                                const next = selectedFamily.facetValueIds.filter(
                                  (id) => !column.values.some((value) => value.id === id),
                                )
                                handleFamilyFacetUpdate(selectedFamily.id, next)
                              }}
                            />
                            None
                          </label>
                          {column.values.map((value) => (
                            <label key={value.id} className="facet__option">
                              <input
                                type="radio"
                                name={`facet-${column.id}`}
                                checked={selectedFamily.facetValueIds.includes(value.id)}
                                onChange={(event) => {
                                  event.stopPropagation()
                                  handleToggleFamilyFacetValue(selectedFamily, column, value.id)
                                }}
                              />
                              {value.displayName}
                            </label>
                          ))}
                        </div>
                      )}
                      {column.type === 'boolean' && (
                        <label className="facet__option">
                          <input
                            type="checkbox"
                            checked={
                              column.values[0]
                                ? selectedFamily.facetValueIds.includes(column.values[0].id)
                                : false
                            }
                            onChange={(event) => {
                              event.stopPropagation()
                              handleToggleBooleanFacet(selectedFamily, column)
                            }}
                          />
                          Enabled
                        </label>
                      )}
                    </div>
                  ))}
                </div>
              </div>
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
            <label className="content__label">
              Search
              <input
                type="search"
                placeholder="Search families or faces"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
              />
            </label>
            <button type="button" onClick={() => setOpenTypePanelOpen((current) => !current)}>
              {openTypePanelOpen ? 'Hide OpenType' : 'Show OpenType'}
            </button>
          </div>

          <style>{fontFaceStyles}</style>

          {openTypePanelOpen && (
            <section className="opentype-panel">
              <div className="opentype-panel__header">
                <h3>OpenType + Variations</h3>
                <p className="opentype-panel__meta">
                  {selectedFace ? `${selectedFamily?.familyName} · ${selectedFace.styleName}` : 'Select a face to edit features.'}
                </p>
              </div>
              {selectedFace && (
                <div className="opentype-panel__content">
                  <div className="opentype-panel__group">
                    <h4>Features</h4>
                    {faceFeatures[selectedFace.id]?.features.length ? (
                      <div className="opentype-panel__grid">
                        {faceFeatures[selectedFace.id]?.features.map((feature) => (
                          <label key={feature.tag} className="opentype-panel__option">
                            <input
                              type="checkbox"
                              checked={faceSettings[selectedFace.id]?.featureStates[feature.tag] ?? false}
                              onChange={() => {
                                setFaceSettings((current) => ({
                                  ...current,
                                  [selectedFace.id]: {
                                    featureStates: {
                                      ...current[selectedFace.id]?.featureStates,
                                      [feature.tag]:
                                        !(current[selectedFace.id]?.featureStates?.[feature.tag] ?? false),
                                    },
                                    axisValues: current[selectedFace.id]?.axisValues ?? {},
                                  },
                                }))
                              }}
                            />
                            <span>{feature.name}</span>
                            <span className="opentype-panel__tag">{feature.tag}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="opentype-panel__empty">No OpenType features reported.</p>
                    )}
                  </div>
                  <div className="opentype-panel__group">
                    <h4>Variable Axes</h4>
                    {faceFeatures[selectedFace.id]?.axes.length ? (
                      <div className="opentype-panel__axes">
                        {faceFeatures[selectedFace.id]?.axes.map((axis) => (
                          <label key={axis.tag} className="opentype-panel__axis">
                            <span className="opentype-panel__axis-name">
                              {axis.name} <span className="opentype-panel__tag">{axis.tag}</span>
                            </span>
                            <input
                              type="range"
                              min={axis.min}
                              max={axis.max}
                              step="1"
                              value={faceSettings[selectedFace.id]?.axisValues[axis.tag] ?? axis.defaultValue}
                              onChange={(event) => {
                                const nextValue = Number(event.target.value)
                                setFaceSettings((current) => ({
                                  ...current,
                                  [selectedFace.id]: {
                                    featureStates: current[selectedFace.id]?.featureStates ?? {},
                                    axisValues: {
                                      ...current[selectedFace.id]?.axisValues,
                                      [axis.tag]: nextValue,
                                    },
                                  },
                                }))
                              }}
                            />
                            <span className="opentype-panel__axis-value">
                              {faceSettings[selectedFace.id]?.axisValues[axis.tag]?.toFixed(0) ?? axis.defaultValue.toFixed(0)}
                            </span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="opentype-panel__empty">No variable axes detected.</p>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="family-grid">
            {filteredFamilies.map((family) => (
              (() => {
                const representative = representativeFaces.get(family.id)
                if (!representative) {
                  return null
                }
                const activeCount = family.faces.filter((face) => face.activated).length
                const activationState =
                  activeCount === 0
                    ? 'inactive'
                    : activeCount === family.faces.length
                      ? 'active'
                      : 'partial'
                return (
              <div
                key={family.id}
                className={`family-tile${selectedFamilyId === family.id ? ' family-tile--selected' : ''}`}
                onClick={() => setSelectedFamilyId(family.id)}
                onDoubleClick={() => undefined}
              >
                <div className="family-tile__header">
                  <div>
                    <p className="family-tile__name">{family.familyName}</p>
                    <p className="family-tile__meta">{representative.styleName}</p>
                  </div>
                  <span className={`family-tile__status family-tile__status--${activationState}`} />
                </div>
                {isCollectionFace(representative) && representative.previewSupported ? (
                  <div className="family-tile__preview family-tile__preview--raster">
                    {previewRenders[representative.id]?.key ===
                    buildPreviewKey(representative.id, faceFeatures[representative.id]) ? (
                      <img
                        src={previewRenders[representative.id]?.dataUrl}
                        alt={`${family.familyName} preview`}
                        className="family-tile__preview-image"
                      />
                    ) : (
                      <span className="family-tile__preview-placeholder">Rendering preview…</span>
                    )}
                  </div>
                ) : (
                  <div
                    className="family-tile__preview"
                    style={{
                      fontFamily: `face_${representative.id}`,
                      fontSize,
                      fontFeatureSettings: buildFeatureSettings(representative.id),
                      fontVariationSettings: buildVariationSettings(representative.id),
                    }}
                  >
                    {sampleText}
                  </div>
                )}
                <div className="family-tile__footer">
                  <span>{family.faces.length} faces</span>
                </div>
              </div>
                )
              })()
            ))}
            {families.length === 0 && (
              <div className="content__empty">
                <h2>No fonts indexed yet</h2>
                <p>Add a source directory to start scanning.</p>
              </div>
            )}
            {families.length > 0 && filteredFamilies.length === 0 && (
              <div className="content__empty">
                <h2>No matches</h2>
                <p>Try clearing filters or searching for another term.</p>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  )
}

export default App
