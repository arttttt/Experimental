# Project Conventions

> Project rules and conventions. Mandatory for all participants (humans and AI).

## Code Style

### Formatting
- Trailing commas — always
- Explicit types — avoid `any`
- async/await — no callback hell
- Comments — in English
- Semicolons — always

### Structure
- Small modules — single responsibility
- Utility functions — class with static methods (not top-level exports)
- Use cases expose a single public method: `execute`
- Domain-level constants belong in `src/domain/constants/`
- React components — one component per file, file name matches component name

### Naming

| Type | Pattern | Example |
|------|---------|---------|
| API client | `*Client` | `JupiterSwapClient`, `BirdeyeClient` |
| In-memory storage | `*Cache` | `PriceCache`, `CandleCache` |
| Database adapter | `*DataSource` | `TradeHistoryDataSource` |
| Repository interface | `*Repository` | `SwapRepository` |
| Use Case | `*UseCase` | `ExecuteSwapUseCase` |
| Zustand store | `*.store.ts` | `market.store.ts` |
| React component | PascalCase `.tsx` | `CandlestickChart.tsx` |
| React hook | `use*.ts` | `useMarketData.ts` |
| IPC handler (main) | `ipc:namespace:action` | `ipc:db:getTradeHistory` |
| Domain policy | `*Policy` | `SlippagePolicy` |

### Branded Types

Primitives (`number`, `string`) are forbidden for ID-like fields. Use class-based branded types.

**Rules:**
- All ID-like fields must use branded types (classes with `readonly value`)
- Use `new Type(value)` at boundaries (API response parsing, DB read, user input)
- Use `.value` to extract primitive at external API boundaries
- Use `.equals()` method for comparison (not `===`)

**Existing types (from CMIDCABot, reuse directly):**
- `TokenMint` — SPL token mint address (base58, 32-44 chars)
- `WalletAddress` — Solana wallet address
- `TxSignature` — Transaction signature

### React & UI Conventions

- **Components** — functional only, no class components
- **State** — Zustand for global state, `useState` for local component state
- **Side effects** — `useEffect` for subscriptions, cleanup on unmount
- **Styling** — Tailwind CSS classes, shadcn/ui for primitives
- **No inline styles** — use Tailwind utilities
- **Chart library** — TradingView lightweight-charts, no other charting libraries

### Zustand Store Conventions

- One store per domain area (`market`, `orders`, `wallet`, `settings`)
- Stores call use cases, do not contain business logic
- Actions are methods on the store, not standalone functions
- Selectors for derived data (avoid computing in components)

## Architecture

See `ARCHITECTURE.md` for full description of layers and rules.

**Key principle:** Clean Architecture — dependencies point inward only.

```
components/stores → domain ← data
                      ↑
                infrastructure
```

Additional rules:
- Domain models are data-only (no validation, no rules, no calculations).
- Domain policies are pure rules/calculations without I/O.
- Use cases orchestrate repositories and policies.
- Stores are thin wrappers — they call use cases and expose state to components.
- Components never import from `data/` or `domain/usecases/` directly.

## Electron / IPC

- **Renderer** never uses Node.js APIs (`fs`, `path`, `crypto`, `child_process`)
- All Node.js operations go through IPC handlers in `electron/main.ts`
- `preload.ts` exposes a typed API via `contextBridge`
- IPC calls are typed end-to-end (shared type definitions)
- API calls (Jupiter, Birdeye, Solana RPC) run in renderer — they are pure HTTP

## Security

- **Secrets** — never in code, only via environment variables or encrypted storage
- **Private keys** — encrypted only (AES-256-GCM), decrypted briefly for signing
- **Seed phrases** — never stored in plaintext, encrypted before persistence
- **Logging** — no sensitive data in logs (addresses OK, keys NEVER)
- **Input validation** — at component/store boundary before use case calls
- **CSP** — Content Security Policy configured in Electron to prevent XSS

## Concurrency

- **Balance-changing operations** — must be serialized (no parallel swaps)
- **WebSocket subscriptions** — single connection per data source, shared across components
- **Candle fetching** — debounce rapid timeframe switches

## Environment

- Keep `.env.example` up-to-date when adding variables
- Solana: mainnet by default, devnet for testing (configurable via settings)
- API keys stored in Electron secure storage or `.env`

## Git Conventions

- Commits — meaningful messages in English
- Branches — `feature/`, `fix/`, `refactor/` prefixes
- PR — mandatory review before merge

## Documentation

| Document | Purpose |
|----------|---------|
| `ARCHITECTURE.md` | Layer structure, dependency rules, IPC contract |
| `conventions.md` | Code style, project rules |
| `CLAUDE.md` | Instructions for AI assistant |
