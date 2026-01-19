import { contextBridge, ipcRenderer } from 'electron';
import type {
  PingResult,
  LibraryFamily,
  LibrarySource,
  FacetColumn,
  FaceFeaturesResult,
  RenderPreviewResult,
} from '@fontman/shared/src/protocol';

const api = {
  getLibraryRoot: (): Promise<string | null> => ipcRenderer.invoke('library:getRoot'),
  chooseLibraryRoot: (): Promise<string | null> => ipcRenderer.invoke('library:chooseRoot'),
  pingHelper: (): Promise<PingResult> => ipcRenderer.invoke('helper:ping'),
  listSources: (): Promise<LibrarySource[]> => ipcRenderer.invoke('sources:list'),
  addSource: (): Promise<LibrarySource | null> => ipcRenderer.invoke('sources:add'),
  scanSource: (sourceId: number): Promise<{ scanned: number; missingPaths: string[] }> =>
    ipcRenderer.invoke('sources:scan', sourceId),
  listFamilies: (): Promise<LibraryFamily[]> => ipcRenderer.invoke('library:listFamilies'),
  listFacets: (): Promise<FacetColumn[]> => ipcRenderer.invoke('facets:list'),
  getFaceFeatures: (path: string, index: number): Promise<FaceFeaturesResult> =>
    ipcRenderer.invoke('faces:getFeatures', path, index),
  renderPreview: (
    path: string,
    index: number,
    text: string,
    size: number,
    features: string[],
    variations: Record<string, number>,
  ): Promise<RenderPreviewResult> =>
    ipcRenderer.invoke('faces:renderPreview', path, index, text, size, features, variations),
  setFamilyFacetValues: (familyId: number, valueIds: number[]): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('facets:setFamilyValues', familyId, valueIds),
  setFaceActivated: (faceId: number, activated: boolean): Promise<{ activated: boolean }> =>
    ipcRenderer.invoke('faces:setActivated', faceId, activated),
};

contextBridge.exposeInMainWorld('fontman', api);

export type FontmanApi = typeof api;
