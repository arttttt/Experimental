/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  ipcRenderer: import('electron').IpcRenderer
  walletCrypto: {
    encrypt: (plaintext: string, password: string) => Promise<string>
    decrypt: (encryptedBase64: string, password: string) => Promise<string>
  }
  tradingDb: {
    createTrade: (trade: {
      id?: string
      pair: string
      side: 'buy' | 'sell'
      quantity: number
      price: number
      fee?: number
      timestamp: number
      status?: 'pending' | 'filled' | 'cancelled' | 'failed'
    }) => Promise<{
      id: string
      pair: string
      side: 'buy' | 'sell'
      quantity: number
      price: number
      fee: number
      timestamp: number
      status: 'pending' | 'filled' | 'cancelled' | 'failed'
      createdAt: number
      updatedAt: number
    }>
    listTrades: (filters?: {
      pair?: string
      status?: 'pending' | 'filled' | 'cancelled' | 'failed'
      fromTimestamp?: number
      toTimestamp?: number
      limit?: number
      offset?: number
    }) => Promise<
      ReadonlyArray<{
        id: string
        pair: string
        side: 'buy' | 'sell'
        quantity: number
        price: number
        fee: number
        timestamp: number
        status: 'pending' | 'filled' | 'cancelled' | 'failed'
        createdAt: number
        updatedAt: number
      }>
    >
    updateTrade: (id: string, patch: Record<string, unknown>) => Promise<{
      id: string
      pair: string
      side: 'buy' | 'sell'
      quantity: number
      price: number
      fee: number
      timestamp: number
      status: 'pending' | 'filled' | 'cancelled' | 'failed'
      createdAt: number
      updatedAt: number
    }>
    deleteTrade: (id: string) => Promise<boolean>
    createPortfolioSnapshot: (snapshot: {
      id?: string
      capturedAt: number
      totalValue: number
      holdings: unknown
    }) => Promise<{
      id: string
      capturedAt: number
      totalValue: number
      holdingsJson: string
      createdAt: number
    }>
    listPortfolioSnapshots: (filters?: {
      fromTimestamp?: number
      toTimestamp?: number
      limit?: number
      offset?: number
    }) => Promise<
      ReadonlyArray<{
        id: string
        capturedAt: number
        totalValue: number
        holdingsJson: string
        createdAt: number
      }>
    >
    deletePortfolioSnapshot: (id: string) => Promise<boolean>
  }
}
