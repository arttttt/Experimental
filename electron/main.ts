import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { KeyEncryptionService } from '../src/infrastructure/internal/crypto'
import { TradingDatabase, type PortfolioSnapshotFilters, type TradeFilters } from './database/TradingDatabase'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
const keyEncryptionService = new KeyEncryptionService()
let tradingDatabase: TradingDatabase | null = null

const getTradingDatabase = (): TradingDatabase => {
  if (!tradingDatabase) {
    throw new Error('Trading database is not initialized yet.')
  }

  return tradingDatabase
}

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  const dbPath = path.join(app.getPath('userData'), 'trading.db')
  tradingDatabase = new TradingDatabase(dbPath)

  ipcMain.handle('ipc:crypto:encrypt', async (_event, plaintext: string, password: string) => {
    return keyEncryptionService.encrypt(plaintext, password)
  })

  ipcMain.handle('ipc:crypto:decrypt', async (_event, encryptedBase64: string, password: string) => {
    return keyEncryptionService.decrypt(encryptedBase64, password)
  })

  ipcMain.handle(
    'ipc:db:trades:create',
    async (
      _event,
      trade: Readonly<{
        id?: string
        pair: string
        side: 'buy' | 'sell'
        quantity: number
        price: number
        fee?: number
        timestamp: number
        status?: 'pending' | 'filled' | 'cancelled' | 'failed'
      }>,
    ) => {
      return getTradingDatabase().createTrade({
        id: trade.id ?? crypto.randomUUID(),
        pair: trade.pair,
        side: trade.side,
        quantity: trade.quantity,
        price: trade.price,
        fee: trade.fee,
        timestamp: trade.timestamp,
        status: trade.status,
      })
    },
  )

  ipcMain.handle('ipc:db:trades:list', async (_event, filters?: TradeFilters) => {
    return getTradingDatabase().listTrades(filters)
  })

  ipcMain.handle('ipc:db:trades:update', async (_event, id: string, patch: Record<string, unknown>) => {
    return getTradingDatabase().updateTrade(id, patch)
  })

  ipcMain.handle('ipc:db:trades:delete', async (_event, id: string) => {
    return getTradingDatabase().deleteTrade(id)
  })

  ipcMain.handle(
    'ipc:db:portfolio-snapshots:create',
    async (
      _event,
      snapshot: Readonly<{
        id?: string
        capturedAt: number
        totalValue: number
        holdings: unknown
      }>,
    ) => {
      return getTradingDatabase().createPortfolioSnapshot({
        id: snapshot.id ?? crypto.randomUUID(),
        capturedAt: snapshot.capturedAt,
        totalValue: snapshot.totalValue,
        holdingsJson: JSON.stringify(snapshot.holdings ?? {}),
      })
    },
  )

  ipcMain.handle('ipc:db:portfolio-snapshots:list', async (_event, filters?: PortfolioSnapshotFilters) => {
    return getTradingDatabase().listPortfolioSnapshots(filters)
  })

  ipcMain.handle('ipc:db:portfolio-snapshots:delete', async (_event, id: string) => {
    return getTradingDatabase().deletePortfolioSnapshot(id)
  })

  ipcMain.handle(
    'ipc:file:save-text',
    async (
      _event,
      options: Readonly<{
        defaultFileName: string
        content: string
      }>,
    ) => {
      const browserWindow = BrowserWindow.getFocusedWindow() ?? win
      const saveOptions = {
        defaultPath: options.defaultFileName,
        filters: [{ name: 'CSV files', extensions: ['csv'] }],
      }
      const saveResult = browserWindow
        ? await dialog.showSaveDialog(browserWindow, saveOptions)
        : await dialog.showSaveDialog(saveOptions)

      if (saveResult.canceled || !saveResult.filePath) {
        return { saved: false as const, canceled: true as const }
      }

      await writeFile(saveResult.filePath, options.content, 'utf8')
      return { saved: true as const, canceled: false as const, filePath: saveResult.filePath }
    },
  )

  createWindow()
})

app.on('before-quit', () => {
  tradingDatabase?.close()
  tradingDatabase = null
})
