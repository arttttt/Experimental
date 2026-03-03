import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})

contextBridge.exposeInMainWorld('walletCrypto', {
  encrypt: (plaintext: string, password: string) => {
    return ipcRenderer.invoke('ipc:crypto:encrypt', plaintext, password)
  },
  decrypt: (encryptedBase64: string, password: string) => {
    return ipcRenderer.invoke('ipc:crypto:decrypt', encryptedBase64, password)
  },
})

contextBridge.exposeInMainWorld('tradingDb', {
  createTrade: (
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
    return ipcRenderer.invoke('ipc:db:trades:create', trade)
  },
  listTrades: (
    filters?: Readonly<{
      pair?: string
      status?: 'pending' | 'filled' | 'cancelled' | 'failed'
      fromTimestamp?: number
      toTimestamp?: number
      limit?: number
      offset?: number
    }>,
  ) => {
    return ipcRenderer.invoke('ipc:db:trades:list', filters)
  },
  updateTrade: (id: string, patch: Record<string, unknown>) => {
    return ipcRenderer.invoke('ipc:db:trades:update', id, patch)
  },
  deleteTrade: (id: string) => {
    return ipcRenderer.invoke('ipc:db:trades:delete', id)
  },
  createPortfolioSnapshot: (
    snapshot: Readonly<{
      id?: string
      capturedAt: number
      totalValue: number
      holdings: unknown
    }>,
  ) => {
    return ipcRenderer.invoke('ipc:db:portfolio-snapshots:create', snapshot)
  },
  listPortfolioSnapshots: (
    filters?: Readonly<{
      fromTimestamp?: number
      toTimestamp?: number
      limit?: number
      offset?: number
    }>,
  ) => {
    return ipcRenderer.invoke('ipc:db:portfolio-snapshots:list', filters)
  },
  deletePortfolioSnapshot: (id: string) => {
    return ipcRenderer.invoke('ipc:db:portfolio-snapshots:delete', id)
  },
})

contextBridge.exposeInMainWorld('fileDialog', {
  saveTextFile: (
    options: Readonly<{
      defaultFileName: string
      content: string
    }>,
  ) => {
    return ipcRenderer.invoke('ipc:file:save-text', options)
  },
})
