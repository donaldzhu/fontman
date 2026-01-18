import { contextBridge, ipcRenderer } from 'electron';
import type { PingResult } from '@fontman/shared/src/protocol';

const api = {
  getLibraryRoot: (): Promise<string | null> => ipcRenderer.invoke('library:getRoot'),
  chooseLibraryRoot: (): Promise<string | null> => ipcRenderer.invoke('library:chooseRoot'),
  pingHelper: (): Promise<PingResult> => ipcRenderer.invoke('helper:ping'),
};

contextBridge.exposeInMainWorld('fontman', api);

export type FontmanApi = typeof api;
