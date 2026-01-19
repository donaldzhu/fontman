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
} from '@fontman/shared/src/protocol'
import { LibraryStore } from './library'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const LIBRARY_POINTER_FILE = 'library-root.txt'
let helperProcess: ReturnType<typeof spawn> | null = null
let helperReady = false
let helperBuffer = ''
let libraryStore: LibraryStore | null = null

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
  })
  helperProcess.stderr?.on('data', (chunk) => {
    console.error('[FontService]', chunk.toString())
  })
  helperProcess.on('exit', () => {
    helperProcess = null
    helperReady = false
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
    const interval = setInterval(() => {
      const newlineIndex = helperBuffer.indexOf('\n')
      if (newlineIndex === -1) {
        return
      }
      const line = helperBuffer.slice(0, newlineIndex)
      helperBuffer = helperBuffer.slice(newlineIndex + 1)
      clearInterval(interval)
      try {
        const response = JSON.parse(line) as JsonRpcResponse<TResult>
        if ('error' in response) {
          reject(new Error(response.error.message))
        } else {
          resolve(response.result)
        }
      } catch (error) {
        reject(error)
      }
    }, 50)
  })
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
  await libraryStore.scanSource(source.id, async (path) =>
    sendHelperRequest<ScanFileResult>({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'scanFile',
      params: { path },
    }),
  )
  return source
})

ipcMain.handle('sources:scan', async (_event, sourceId: number) => {
  if (!libraryStore) {
    return { scanned: 0 }
  }
  return libraryStore.scanSource(sourceId, async (path) =>
    sendHelperRequest<ScanFileResult>({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'scanFile',
      params: { path },
    }),
  )
})

ipcMain.handle('library:listFamilies', async (): Promise<LibraryFamily[]> => {
  if (!libraryStore) {
    return []
  }
  return libraryStore.listFamilies()
})
