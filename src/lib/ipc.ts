export type WalletCryptoApi = Readonly<{
  encrypt: (plaintext: string, password: string) => Promise<string>;
  decrypt: (encryptedBase64: string, password: string) => Promise<string>;
}>;

export type SaveTextFileResult =
  | Readonly<{
      saved: true;
      canceled: false;
      filePath: string;
    }>
  | Readonly<{
      saved: false;
      canceled: true;
    }>;

export type FileDialogApi = Readonly<{
  saveTextFile: (options: Readonly<{ defaultFileName: string; content: string }>) => Promise<SaveTextFileResult>;
}>;

export type TradeSide = 'buy' | 'sell';
export type TradeStatus = 'pending' | 'filled' | 'cancelled' | 'failed';

export type TradeRecord = Readonly<{
  id: string;
  pair: string;
  side: TradeSide;
  quantity: number;
  price: number;
  fee: number;
  timestamp: number;
  status: TradeStatus;
  createdAt: number;
  updatedAt: number;
}>;

export type CreateTradeInput = Readonly<{
  id?: string;
  pair: string;
  side: TradeSide;
  quantity: number;
  price: number;
  fee?: number;
  timestamp: number;
  status?: TradeStatus;
}>;

export type TradeFilters = Readonly<{
  pair?: string;
  status?: TradeStatus;
  fromTimestamp?: number;
  toTimestamp?: number;
  limit?: number;
  offset?: number;
}>;

export type UpdateTradeInput = Readonly<{
  pair?: string;
  side?: TradeSide;
  quantity?: number;
  price?: number;
  fee?: number;
  timestamp?: number;
  status?: TradeStatus;
}>;

export type PortfolioSnapshotRecord = Readonly<{
  id: string;
  capturedAt: number;
  totalValue: number;
  holdingsJson: string;
  createdAt: number;
}>;

export type CreatePortfolioSnapshotInput = Readonly<{
  id?: string;
  capturedAt: number;
  totalValue: number;
  holdings: unknown;
}>;

export type PortfolioSnapshotFilters = Readonly<{
  fromTimestamp?: number;
  toTimestamp?: number;
  limit?: number;
  offset?: number;
}>;

export type TradingDbApi = Readonly<{
  createTrade: (trade: CreateTradeInput) => Promise<TradeRecord>;
  listTrades: (filters?: TradeFilters) => Promise<ReadonlyArray<TradeRecord>>;
  updateTrade: (id: string, patch: UpdateTradeInput) => Promise<TradeRecord>;
  deleteTrade: (id: string) => Promise<boolean>;
  createPortfolioSnapshot: (snapshot: CreatePortfolioSnapshotInput) => Promise<PortfolioSnapshotRecord>;
  listPortfolioSnapshots: (filters?: PortfolioSnapshotFilters) => Promise<ReadonlyArray<PortfolioSnapshotRecord>>;
  deletePortfolioSnapshot: (id: string) => Promise<boolean>;
}>;

const WALLET_CRYPTO_UNAVAILABLE_ERROR =
  'Wallet crypto API is unavailable. Use the Electron app shell to access secure key operations.';
const FILE_DIALOG_UNAVAILABLE_ERROR =
  'File dialog API is unavailable. Use the Electron app shell to access save dialogs.';
const TRADING_DB_UNAVAILABLE_ERROR =
  'Trading DB API is unavailable. Use the Electron app shell to access SQLite-backed storage.';

const walletCryptoApiOrThrow = (): WalletCryptoApi => {
  const walletCrypto = window.walletCrypto;

  if (
    typeof walletCrypto?.encrypt === 'function' &&
    typeof walletCrypto?.decrypt === 'function'
  ) {
    return walletCrypto;
  }

  throw new Error(WALLET_CRYPTO_UNAVAILABLE_ERROR);
};

const fileDialogApiOrThrow = (): FileDialogApi => {
  const fileDialog = window.fileDialog;

  if (typeof fileDialog?.saveTextFile === 'function') {
    return fileDialog;
  }

  throw new Error(FILE_DIALOG_UNAVAILABLE_ERROR);
};

const tradingDbApiOrThrow = (): TradingDbApi => {
  const tradingDb = window.tradingDb;

  if (
    typeof tradingDb?.createTrade === 'function' &&
    typeof tradingDb?.listTrades === 'function' &&
    typeof tradingDb?.updateTrade === 'function' &&
    typeof tradingDb?.deleteTrade === 'function' &&
    typeof tradingDb?.createPortfolioSnapshot === 'function' &&
    typeof tradingDb?.listPortfolioSnapshots === 'function' &&
    typeof tradingDb?.deletePortfolioSnapshot === 'function'
  ) {
    return tradingDb;
  }

  throw new Error(TRADING_DB_UNAVAILABLE_ERROR);
};

export const ipc = {
  crypto: {
    encrypt: async (plaintext: string, password: string) => {
      return walletCryptoApiOrThrow().encrypt(plaintext, password);
    },
    decrypt: async (encryptedBase64: string, password: string) => {
      return walletCryptoApiOrThrow().decrypt(encryptedBase64, password);
    },
  } satisfies WalletCryptoApi,
  fileDialog: {
    saveTextFile: async (options: Readonly<{ defaultFileName: string; content: string }>) => {
      return fileDialogApiOrThrow().saveTextFile(options);
    },
  } satisfies FileDialogApi,
  db: {
    createTrade: async (trade: CreateTradeInput) => {
      return tradingDbApiOrThrow().createTrade(trade);
    },
    listTrades: async (filters?: TradeFilters) => {
      return tradingDbApiOrThrow().listTrades(filters);
    },
    updateTrade: async (id: string, patch: UpdateTradeInput) => {
      return tradingDbApiOrThrow().updateTrade(id, patch);
    },
    deleteTrade: async (id: string) => {
      return tradingDbApiOrThrow().deleteTrade(id);
    },
    createPortfolioSnapshot: async (snapshot: CreatePortfolioSnapshotInput) => {
      return tradingDbApiOrThrow().createPortfolioSnapshot(snapshot);
    },
    listPortfolioSnapshots: async (filters?: PortfolioSnapshotFilters) => {
      return tradingDbApiOrThrow().listPortfolioSnapshots(filters);
    },
    deletePortfolioSnapshot: async (id: string) => {
      return tradingDbApiOrThrow().deletePortfolioSnapshot(id);
    },
  } satisfies TradingDbApi,
} as const;
