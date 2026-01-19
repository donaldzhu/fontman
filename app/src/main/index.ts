import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron'
import { join, extname } from 'node:path'
import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createReadStream } from 'node:fs'
import type {
  JsonRpcResponse,
  JsonRpcRequest,
  PingResult,
  ScanFileResult,
  LibrarySource,
  LibraryFamily,
  HelperEvent,
  WatchSourcesResult,
  UnregisterFontResult,
  RegisterFontResult,
  IsFontRegisteredResult,
} from '@fontman/shared/src/protocol'
import { LibraryStore } from './library'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const LIBRARY_POINTER_FILE = 'library-root.txt'
let helperProcess: ReturnType<typeof spawn> | null = null
let helperReady = false
let helperBuffer = ''
let libraryStore: LibraryStore | null = null
const helperPending = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>()
const pendingPaths = new Set<string>()
let processingPaths = false

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'fontman',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

const getPointerPath = () => join(app.getPath('userData'), LIBRARY_POINTER_FILE)

const readLibraryRootPointer = async (): Promise<string | null> => {
  try {
    const content = await fs.readFile(getPointerPath(), 'utf-8')
    return content.trim() || null
  } catch {
    return null
  }
}

const writeLibraryRootPointer = async (path: string) => {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(getPointerPath(), path, 'utf-8')
}

const chooseLibraryRoot = async (): Promise<string | null> => {
  const result = await dialog.showOpenDialog({
    title: 'Choose Font Library Folder',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  const selected = result.filePaths[0]
  await writeLibraryRootPointer(selected)
  libraryStore = new LibraryStore(selected)
  return selected
}

const ensureLibraryRoot = async (): Promise<string | null> => {
  const existing = await readLibraryRootPointer()
  if (existing) {
    return existing
  }
  return chooseLibraryRoot()
}

const resolveHelperPath = () => {
  if (process.env.FONTMAN_HELPER_PATH) {
    return process.env.FONTMAN_HELPER_PATH
  }
  return join(process.cwd(), '..', 'native', 'FontService', '.build', 'debug', 'FontService')
}

const startHelper = async () => {
  if (helperProcess) {
    return
  }
  const helperPath = resolveHelperPath()
  helperProcess = spawn(helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'] })
  helperProcess.stdout?.on('data', (chunk) => {
    helperBuffer += chunk.toString()
    while (helperBuffer.includes('\n')) {
      const newlineIndex = helperBuffer.indexOf('\n')
      const line = helperBuffer.slice(0, newlineIndex).trim()
      helperBuffer = helperBuffer.slice(newlineIndex + 1)
      if (!line) {
        continue
      }
      handleHelperLine(line)
    }
  })
  helperProcess.stderr?.on('data', (chunk) => {
    console.error('[FontService]', chunk.toString())
  })
  helperProcess.on('exit', () => {
    helperProcess = null
    helperReady = false
    for (const pending of helperPending.values()) {
      pending.reject(new Error('FontService helper exited'))
    }
    helperPending.clear()
  })
  helperReady = true
}

const registerFontProtocol = () => {
  protocol.registerStreamProtocol('fontman', (request, callback) => {
    const url = new URL(request.url)
    const filePath = url.searchParams.get('path')
    if (!filePath) {
      callback({ statusCode: 400 })
      return
    }
    const ext = extname(filePath).toLowerCase()
    const mime =
      ext === '.otf'
        ? 'font/otf'
        : ext === '.ttf'
          ? 'font/ttf'
          : ext === '.woff'
            ? 'font/woff'
            : ext === '.woff2'
              ? 'font/woff2'
              : 'application/octet-stream'
    callback({
      statusCode: 200,
      headers: { 'Content-Type': mime },
      data: createReadStream(filePath),
    })
  })
}

const sendHelperRequest = async <TResult>(request: JsonRpcRequest): Promise<TResult> => {
  if (!helperProcess || !helperProcess.stdin || !helperReady) {
    throw new Error('FontService helper not running')
  }
  helperProcess.stdin.write(`${JSON.stringify(request)}\n`)
  return new Promise((resolve, reject) => {
    helperPending.set(String(request.id), {
      resolve: resolve as (value: unknown) => void,
      reject,
    })
  })
}

const handleHelperLine = (line: string) => {
  let payload: HelperEvent | JsonRpcResponse
  try {
    payload = JSON.parse(line)
  } catch (error) {
    console.error('Failed to parse helper payload', error)
    return
  }
  if ('event' in payload) {
    handleHelperEvent(payload)
    return
  }
  if (!('id' in payload)) {
    return
  }
  const pending = helperPending.get(String(payload.id))
  if (!pending) {
    return
  }
  helperPending.delete(String(payload.id))
  if ('error' in payload) {
    pending.reject(new Error(payload.error.message))
  } else {
    pending.resolve(payload.result)
  }
}

const scanFileWithHelper = async (path: string) =>
  sendHelperRequest<ScanFileResult>({
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'scanFile',
    params: { path },
  })

const handleMissingPath = async (path: string) => {
  if (!libraryStore) {
    return
  }
  const missing = libraryStore.markFileMissing(path)
  if (!missing) {
    const removed = libraryStore.markMissingUnderPath(path)
    if (removed.length === 0) {
      return
    }
    for (const removedPath of removed) {
      try {
        await sendHelperRequest<UnregisterFontResult>({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'unregisterFont',
          params: { path: removedPath },
        })
      } catch {
        // ignore unregister failures
      }
    }
    return
  }
  try {
    await sendHelperRequest<UnregisterFontResult>({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'unregisterFont',
      params: { path },
    })
  } catch {
    // ignore unregister failures
  }
}

const reconcileActivationState = async () => {
  if (!libraryStore) {
    return
  }
  const activationFiles = libraryStore.listActivationFiles()
  for (const entry of activationFiles) {
    if (!entry.installSupported || entry.status !== 'ok') {
      continue
    }
    let registered = false
    try {
      const status = await sendHelperRequest<IsFontRegisteredResult>({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'isFontRegistered',
        params: { path: entry.filePath },
      })
      registered = status.registered
    } catch {
      continue
    }
    if (entry.activatedCount > 0 && !registered) {
      try {
        await sendHelperRequest<RegisterFontResult>({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'registerFont',
          params: { path: entry.filePath },
        })
      } catch {
        // ignore activation failures
      }
    }
    if (entry.activatedCount === 0 && registered) {
      try {
        await sendHelperRequest<UnregisterFontResult>({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'unregisterFont',
          params: { path: entry.filePath },
        })
      } catch {
        // ignore unregister failures
      }
    }
  }
}

const handleSourcePathChange = async (path: string) => {
  if (!libraryStore) {
    return
  }
  try {
    const stats = await fs.stat(path)
    if (stats.isDirectory()) {
      const source = libraryStore.findSourceForPath(path)
      if (source && source.path === path) {
        const result = await libraryStore.scanSource(source.id, scanFileWithHelper)
        for (const missingPath of result.missingPaths) {
          await handleMissingPath(missingPath)
        }
      }
      return
    }
    if (stats.isFile()) {
      const result = await libraryStore.scanFilePath(path, scanFileWithHelper)
      for (const missingPath of result.missingPaths) {
        await handleMissingPath(missingPath)
      }
    }
  } catch {
    await handleMissingPath(path)
  }
}

const processPendingPaths = async () => {
  if (processingPaths || pendingPaths.size === 0) {
    return
  }
  processingPaths = true
  const paths = Array.from(pendingPaths)
  pendingPaths.clear()
  for (const path of paths) {
    await handleSourcePathChange(path)
  }
  processingPaths = false
  if (pendingPaths.size > 0) {
    processPendingPaths()
  }
}

const handleHelperEvent = (event: HelperEvent) => {
  switch (event.event) {
    case 'sourceChanged':
      for (const change of event.changes) {
        pendingPaths.add(change.path)
      }
      processPendingPaths()
      break
    case 'fileMissing':
      pendingPaths.add(event.path)
      processPendingPaths()
      break
    default:
      break
  }
}

const createWindow = async () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, '../preload/index.cjs'),
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  const libraryRoot = await ensureLibraryRoot()
  if (!libraryRoot) {
    app.quit()
    return
  }
  libraryStore = new LibraryStore(libraryRoot)
  await startHelper()
  await syncHelperSources()
  await reconcileActivationState()
  registerFontProtocol()
  await createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

ipcMain.handle('library:getRoot', async () => readLibraryRootPointer())
ipcMain.handle('library:chooseRoot', async () => chooseLibraryRoot())
ipcMain.handle('helper:ping', async () => {
  await startHelper()
  const result = await sendHelperRequest<PingResult>({
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'ping',
  })
  return result
})

const syncHelperSources = async () => {
  if (!libraryStore || !helperReady) {
    return
  }
  const sources = libraryStore.listSources().filter((source) => source.isEnabled)
  try {
    await sendHelperRequest<WatchSourcesResult>({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'watchSources',
      params: { paths: sources.map((source) => source.path) },
    })
  } catch (error) {
    console.error('Failed to sync helper sources', error)
  }
}

ipcMain.handle('sources:list', async (): Promise<LibrarySource[]> => {
  if (!libraryStore) {
    return []
  }
  return libraryStore.listSources()
})

ipcMain.handle('sources:add', async (): Promise<LibrarySource | null> => {
  if (!libraryStore) {
    return null
  }
  const result = await dialog.showOpenDialog({
    title: 'Add Font Source Folder',
    properties: ['openDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  const source = libraryStore.addSource(result.filePaths[0])
  const scanResult = await libraryStore.scanSource(source.id, scanFileWithHelper)
  for (const missingPath of scanResult.missingPaths) {
    await handleMissingPath(missingPath)
  }
  await syncHelperSources()
  return source
})

ipcMain.handle('sources:scan', async (_event, sourceId: number) => {
  if (!libraryStore) {
    return { scanned: 0, missingPaths: [] }
  }
  const result = await libraryStore.scanSource(sourceId, scanFileWithHelper)
  for (const missingPath of result.missingPaths) {
    await handleMissingPath(missingPath)
  }
  return result
})

ipcMain.handle('library:listFamilies', async (): Promise<LibraryFamily[]> => {
  if (!libraryStore) {
    return []
  }
  return libraryStore.listFamilies()
})

ipcMain.handle(
  'faces:setActivated',
  async (_event, faceId: number, activated: boolean): Promise<{ activated: boolean }> => {
    if (!libraryStore) {
      return { activated: false }
    }
    const update = libraryStore.setFaceActivated(faceId, activated)
    if (!update) {
      return { activated: false }
    }
    if (!update.installSupported) {
      return { activated: false }
    }
    if (update.shouldRegister) {
      try {
        await sendHelperRequest<RegisterFontResult>({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'registerFont',
          params: { path: update.filePath },
        })
      } catch {
        // ignore register failures
      }
    }
    if (update.shouldUnregister) {
      try {
        await sendHelperRequest<UnregisterFontResult>({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'unregisterFont',
          params: { path: update.filePath },
        })
      } catch {
        // ignore unregister failures
      }
    }
    return { activated: update.activated }
  },
)
