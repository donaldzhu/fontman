import { contextBridge, ipcRenderer } from 'electron';
import type { PingResult, LibraryFamily, LibrarySource } from '@fontman/shared/src/protocol';

const api = {
  getLibraryRoot: (): Promise<string | null> => ipcRenderer.invoke('library:getRoot'),
  chooseLibraryRoot: (): Promise<string | null> => ipcRenderer.invoke('library:chooseRoot'),
  pingHelper: (): Promise<PingResult> => ipcRenderer.invoke('helper:ping'),
  listSources: (): Promise<LibrarySource[]> => ipcRenderer.invoke('sources:list'),
  addSource: (): Promise<LibrarySource | null> => ipcRenderer.invoke('sources:add'),
  scanSource: (sourceId: number): Promise<{ scanned: number; missingPaths: string[] }> =>
    ipcRenderer.invoke('sources:scan', sourceId),
  listFamilies: (): Promise<LibraryFamily[]> => ipcRenderer.invoke('library:listFamilies'),
  setFaceActivated: (faceId: number, activated: boolean): Promise<{ activated: boolean }> =>
    ipcRenderer.invoke('faces:setActivated', faceId, activated),
};

contextBridge.exposeInMainWorld('fontman', api);

export type FontmanApi = typeof api;
