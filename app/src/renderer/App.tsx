import { useEffect, useMemo, useState } from 'react';
import type {
  LibraryFamily,
  LibraryFace,
  LibrarySource,
  FacetColumn,
} from '@fontman/shared/src/protocol';

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
      listFacets: () => Promise<FacetColumn[]>;
      setFamilyFacetValues: (familyId: number, valueIds: number[]) => Promise<{ ok: boolean }>;
      setFaceActivated: (faceId: number, activated: boolean) => Promise<{ activated: boolean }>;
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
  const [facetColumns, setFacetColumns] = useState<FacetColumn[]>([]);
  const [sampleText, setSampleText] = useState('The quick brown fox jumps over the lazy dog.');
  const [fontSize, setFontSize] = useState(26);
  const [isScanning, setIsScanning] = useState(false);
  const [activationUpdate, setActivationUpdate] = useState(false);
  const [selectedFamilyId, setSelectedFamilyId] = useState<number | null>(null);
  const [searchText, setSearchText] = useState('');
  const [facetFilters, setFacetFilters] = useState<
    Record<
      number,
      | { type: 'multi'; selectedValueIds: number[] }
      | { type: 'single'; selectedValueId: number | null }
      | { type: 'boolean'; state: 'any' | 'yes' | 'no' }
    >
  >({});

  const refreshSources = async () => {
    const data = await window.fontman.listSources();
    setSources(data);
  };

  const refreshFamilies = async () => {
    const data = await window.fontman.listFamilies();
    setFamilies(data);
  };

  const refreshFacets = async () => {
    const data = await window.fontman.listFacets();
    setFacetColumns(data);
  };

  useEffect(() => {
    window.fontman.getLibraryRoot().then(setLibraryRoot);
    refreshSources();
    refreshFamilies();
    refreshFacets();
  }, []);

  useEffect(() => {
    setFacetFilters((current) => {
      const next = { ...current };
      for (const column of facetColumns) {
        if (!next[column.id]) {
          if (column.type === 'multi') {
            next[column.id] = { type: 'multi', selectedValueIds: [] };
          } else if (column.type === 'single') {
            next[column.id] = { type: 'single', selectedValueId: null };
          } else {
            next[column.id] = { type: 'boolean', state: 'any' };
          }
        }
      }
      return next;
    });
  }, [facetColumns]);

  const handleChooseLibrary = async () => {
    const root = await window.fontman.chooseLibraryRoot();
    setLibraryRoot(root);
    await refreshSources();
    await refreshFamilies();
    await refreshFacets();
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

  const handleToggleActivation = async (face: LibraryFace) => {
    setActivationUpdate(true);
    await window.fontman.setFaceActivated(face.id, !face.activated);
    await refreshFamilies();
    setActivationUpdate(false);
  };

  const updateFacetFilter = (
    columnId: number,
    update:
      | { type: 'multi'; selectedValueIds: number[] }
      | { type: 'single'; selectedValueId: number | null }
      | { type: 'boolean'; state: 'any' | 'yes' | 'no' },
  ) => {
    setFacetFilters((current) => ({ ...current, [columnId]: update }));
  };

  const handleToggleFacetFilterValue = (columnId: number, valueId: number) => {
    const filter = facetFilters[columnId];
    if (!filter || filter.type !== 'multi') {
      return;
    }
    const selected = filter.selectedValueIds.includes(valueId)
      ? filter.selectedValueIds.filter((id) => id !== valueId)
      : [...filter.selectedValueIds, valueId];
    updateFacetFilter(columnId, { type: 'multi', selectedValueIds: selected });
  };

  const selectedFamily = useMemo(
    () => families.find((family) => family.id === selectedFamilyId) ?? null,
    [families, selectedFamilyId],
  );

  const handleFamilyFacetUpdate = async (familyId: number, valueIds: number[]) => {
    await window.fontman.setFamilyFacetValues(familyId, valueIds);
    await refreshFamilies();
  };

  const handleToggleFamilyFacetValue = async (family: LibraryFamily, column: FacetColumn, valueId: number) => {
    const current = family.facetValueIds;
    let next = [...current];
    if (column.type === 'multi') {
      if (next.includes(valueId)) {
        next = next.filter((id) => id !== valueId);
      } else {
        next = [...next, valueId];
      }
    } else {
      next = next.filter((id) => !column.values.some((value) => value.id === id));
      if (!current.includes(valueId)) {
        next.push(valueId);
      }
    }
    await handleFamilyFacetUpdate(family.id, next);
  };

  const handleToggleBooleanFacet = async (family: LibraryFamily, column: FacetColumn) => {
    const valueId = column.values[0]?.id;
    if (!valueId) {
      return;
    }
    const current = family.facetValueIds;
    const next = current.includes(valueId) ? current.filter((id) => id !== valueId) : [...current, valueId];
    await handleFamilyFacetUpdate(family.id, next);
  };

  const fontFaceStyles = useMemo(() => {
    const faces = families.flatMap((family) => family.faces);
    return faces.map(buildFontFaceRule).join('\n');
  }, [families]);

  const filteredFamilies = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();
    return families.filter((family) => {
      if (normalizedSearch) {
        const familyMatch = family.familyName.toLowerCase().includes(normalizedSearch);
        const faceMatch = family.faces.some((face) =>
          `${face.fullName} ${face.styleName}`.toLowerCase().includes(normalizedSearch),
        );
        if (!familyMatch && !faceMatch) {
          return false;
        }
      }
      for (const column of facetColumns) {
        const filter = facetFilters[column.id];
        if (!filter) {
          continue;
        }
        if (column.type === 'multi' && filter.type === 'multi') {
          if (filter.selectedValueIds.length === 0) {
            continue;
          }
          const matches = filter.selectedValueIds.some((id) => family.facetValueIds.includes(id));
          if (!matches) {
            return false;
          }
        } else if (column.type === 'single' && filter.type === 'single') {
          if (filter.selectedValueId == null) {
            continue;
          }
          if (!family.facetValueIds.includes(filter.selectedValueId)) {
            return false;
          }
        } else if (column.type === 'boolean' && filter.type === 'boolean') {
          const valueId = column.values[0]?.id;
          if (!valueId || filter.state === 'any') {
            continue;
          }
          const hasValue = family.facetValueIds.includes(valueId);
          if (filter.state === 'yes' && !hasValue) {
            return false;
          }
          if (filter.state === 'no' && hasValue) {
            return false;
          }
        }
      }
      return true;
    });
  }, [families, facetColumns, facetFilters, searchText]);

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
          <div className="sidebar__section">
            <h3>Facet Filters</h3>
            {facetColumns.length === 0 && <p className="sidebar__empty">No facet schema yet.</p>}
            {facetColumns.map((column) => {
              const filter = facetFilters[column.id];
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
                );
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
                );
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
                );
              }
              return null;
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
                        disabled={!face.installSupported || activationUpdate}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleToggleActivation(face);
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
                                  event.stopPropagation();
                                  handleToggleFamilyFacetValue(selectedFamily, column, value.id);
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
                                event.stopPropagation();
                                const next = selectedFamily.facetValueIds.filter(
                                  (id) => !column.values.some((value) => value.id === id),
                                );
                                handleFamilyFacetUpdate(selectedFamily.id, next);
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
                                  event.stopPropagation();
                                  handleToggleFamilyFacetValue(selectedFamily, column, value.id);
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
                              event.stopPropagation();
                              handleToggleBooleanFacet(selectedFamily, column);
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
          </div>

          <style>{fontFaceStyles}</style>

          <section className="family-grid">
            {filteredFamilies.map((family) => (
              <div
                key={family.id}
                className={`family-card${selectedFamilyId === family.id ? ' family-card--selected' : ''}`}
                onClick={() => setSelectedFamilyId(family.id)}
              >
                <div className="family-card__header">
                  <h2>{family.familyName}</h2>
                  <span>{family.faces.length} faces</span>
                </div>
                <div className="family-card__faces">
                  {family.faces.map((face) => (
                    <div key={face.id} className="face-tile">
                      <p className="face-tile__name">{face.fullName}</p>
                      <p className="face-tile__style">{face.styleName}</p>
                      <button
                        type="button"
                        className="face-tile__toggle"
                        disabled={!face.installSupported || activationUpdate}
                        onClick={() => handleToggleActivation(face)}
                      >
                        {face.activated ? 'Deactivate' : 'Activate'}
                      </button>
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
  );
};

export default App;
