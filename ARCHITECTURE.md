# Architecture

> Single source of truth for project architecture. All other docs reference this file.

## Overview

Desktop trading terminal for Solana built on Electron + React. Manual trading and charting
via Jupiter DEX and Birdeye/DexScreener market data. Bot mode deferred to last phase.

## Process Model

```
┌─────────────────────────────────────────────┐
│           Electron Main Process             │
│         (main.ts, preload.ts, IPC)          │
│                                             │
│  Responsibilities:                          │
│  - SQLite database access (better-sqlite3)  │
│  - Filesystem operations                    │
│  - Secure key storage                       │
│  - Window management                        │
└────────────────────┬────────────────────────┘
                     │ IPC bridge (contextBridge)
┌────────────────────▼────────────────────────┐
│           Renderer Process (React)          │
│                                             │
│  Responsibilities:                          │
│  - UI rendering (React + shadcn/ui)         │
│  - Charts (TradingView lightweight-charts)  │
│  - State management (Zustand)               │
│  - API calls (Jupiter, Birdeye, Solana RPC) │
│  - Wallet operations (@solana/kit)          │
└─────────────────────────────────────────────┘
```

**IPC boundary rule:** Renderer NEVER accesses Node.js APIs directly.
All Node.js operations (SQLite, filesystem, encryption) go through IPC handlers
exposed via `preload.ts` + `contextBridge`.

API calls (Jupiter, Birdeye, Solana RPC) run in the renderer process —
they are pure HTTP/WebSocket and don't need Node.js APIs.

## Target Directory Structure

```
electron/
├── main.ts                  # Electron entry point, IPC handlers
└── preload.ts               # contextBridge, IPC bridge to renderer

src/
├── app/
│   ├── App.tsx              # Root component, layout
│   ├── router.tsx           # Screen navigation
│   └── index.css            # Tailwind + global styles
│
├── domain/
│   ├── models/              # Data-only entities
│   │   ├── id/              # Branded types (TokenMint, WalletAddress, TxSignature)
│   │   └── quote/           # SwapQuote
│   ├── constants/           # Shared domain constants
│   ├── policies/            # Pure domain rules (no I/O)
│   ├── usecases/            # Business logic orchestration
│   └── repositories/        # Interfaces (ports)
│
├── data/
│   ├── repositories/        # Repository implementations
│   │   ├── memory/          # In-memory caches (balances, prices)
│   │   └── sqlite/          # SQLite-backed repositories (via IPC)
│   └── sources/
│       ├── api/             # External API clients
│       │   ├── JupiterSwapClient.ts
│       │   ├── JupiterPriceClient.ts
│       │   ├── SolanaRpcClient.ts
│       │   ├── BirdeyeClient.ts
│       │   └── DexScreenerClient.ts
│       ├── database/        # SQLite adapters (IPC wrappers)
│       └── memory/          # In-memory caches
│
├── infrastructure/
│   ├── internal/            # Only for data layer
│   │   └── crypto/          # KeyEncryption (AES-256-GCM)
│   └── shared/              # Accessible by all layers
│       ├── logging/         # Logger
│       ├── config/          # AppConfig, token definitions
│       ├── math/            # Decimal precision utilities
│       └── resilience/      # Retry, backoff utilities
│
├── components/
│   ├── chart/               # Candlestick, indicators, toolbar
│   ├── trading/             # OrderForm, OpenOrders, TradeHistory
│   ├── portfolio/           # BalanceCard, Holdings, PnLChart
│   ├── wallet/              # WalletConnect, WalletInfo
│   ├── sidebar/             # Navigation sidebar
│   └── ui/                  # shadcn/ui primitives
│
├── stores/                  # Zustand stores
│   ├── market.store.ts      # Prices, candles, tickers
│   ├── orders.store.ts      # Orders, trade history
│   ├── wallet.store.ts      # Wallet state, balances
│   └── settings.store.ts    # User preferences
│
├── features/
│   ├── market-data/         # OHLCV fetching, price streaming, cache
│   ├── orders/              # Swap execution, limit orders
│   ├── wallet/              # Connection, keypair, balance management
│   └── indicators/          # TA calculation (RSI, MA, MACD, Bollinger)
│
├── hooks/                   # React hooks
│
├── services/                # Thin service wrappers (if needed)
│
└── lib/
    ├── constants.ts         # Token addresses, API endpoints
    ├── types.ts             # Shared types
    └── ipc.ts               # Typed IPC client for renderer
```

## Layer Access Rules

```
domain          → infrastructure/shared (logging, math, config)
                → domain/policies
data            → domain/repositories (interfaces)
                → domain/models
                → domain/policies
                → infrastructure/internal
                → infrastructure/shared
components      → stores (Zustand)
                → hooks
                → domain/models (for types)
stores          → domain/usecases
                → domain/models
features        → data/sources
                → domain/models
                → infrastructure/shared
hooks           → stores
                → domain/usecases
infrastructure  → (nothing, except shared between own modules)
electron/       → infrastructure/internal (crypto, DB)
```

**Key rule:** Dependencies point inward only. React components never import from `data/` or `domain/usecases/` directly — they go through stores and hooks.

## Domain Models & Policies

- **Domain models** — only data and types. No validation, no calculations, no business rules.
- **Domain policies** — pure business rules and calculations. No I/O, no repository calls.
- **Use cases** — scenarios. They call repositories and policies to complete a flow.
- **Stores** — UI state derived from use cases. Stores call use cases, components read stores.

## Key Principles

| Principle | Description |
|-----------|-------------|
| Service = API client only | HTTP/RPC/WebSocket clients to external systems |
| Services behind repositories | Domain works only with interfaces |
| Data sources by type | Separation: database / memory / api |
| Infrastructure: internal/shared | internal — data only, shared — all layers |
| Use cases return domain objects | Not UI structures — components handle display |
| IPC as boundary | Node.js operations (DB, crypto, FS) only via IPC |
| Explicit dependencies | Constructor injection for services, no global state |
| Stores are thin | Stores call use cases, don't contain business logic |

## Anti-patterns (Prohibited)

| Prohibition | Reason |
|-------------|--------|
| **Utils/helpers/common** | Become dumps. Each component must have a specific place |
| **Domain Services** | Not used. All business logic in Use Cases |
| **Direct service access from domain** | Domain works only with repository interfaces |
| **Business logic in data layer** | Data only stores/retrieves, makes no decisions |
| **Business logic in components** | Components display, logic belongs in use cases/policies |
| **Business logic in stores** | Stores are thin wrappers around use cases |
| **Direct DB access from renderer** | Must go through IPC to main process |
| **Framework deps in domain** | Domain must be pure, no React/Electron imports |
| **Node.js APIs in renderer** | Use IPC bridge, never require() Node modules |

## Naming Conventions

| Component Type | Suffix/Pattern | Example |
|----------------|----------------|---------|
| API client | `*Client` | `SolanaRpcClient`, `BirdeyeClient` |
| In-memory storage | `*Cache` | `PriceCache`, `CandleCache` |
| Database adapter | `*DataSource` | `TradeHistoryDataSource` |
| Repository interface | `*Repository` | `SwapRepository` |
| Use Case | `*UseCase` | `ExecuteSwapUseCase` |
| Zustand store | `*.store.ts` | `market.store.ts` |
| React component | PascalCase | `CandlestickChart` |
| React hook | `use*` | `useMarketData` |
| IPC handler | `ipc:*` | `ipc:db:query`, `ipc:crypto:encrypt` |

## IPC Contract

Main process exposes handlers via `ipcMain.handle()`. Renderer calls via typed wrapper.

```typescript
// electron/main.ts
ipcMain.handle('db:getTradeHistory', async (_, params) => { ... });
ipcMain.handle('crypto:encrypt', async (_, plaintext) => { ... });

// src/lib/ipc.ts (renderer)
export const ipc = {
  db: {
    getTradeHistory: (params) => window.electron.invoke('db:getTradeHistory', params),
  },
  crypto: {
    encrypt: (plaintext) => window.electron.invoke('crypto:encrypt', plaintext),
  },
};
```

## External APIs

| API | Purpose | Limits (free) |
|-----|---------|---------------|
| Jupiter Swap API v1 | Swaps, route optimization | Unlimited (API key recommended) |
| Jupiter Price API v3 | Current token prices | Unlimited (API key required) |
| Birdeye API | OHLCV candles, token history | 1000 req/day |
| DexScreener API | Candles, pairs (fallback) | Unlimited |
| Solana RPC | Transactions, balances | Provider-dependent |
