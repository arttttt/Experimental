# Solana Trading Terminal

> **CRITICAL: Rules in this file are MANDATORY. Follow them with highest priority.**

## MANDATORY: Read Before Any Work

Before writing any code, read these files:
- `ARCHITECTURE.md` — layer structure, dependency rules, IPC contract
- `conventions.md` — code style, naming, security rules

## CRITICAL RULES (MUST FOLLOW)

1. **ALWAYS respond in Russian** — no exceptions (code comments in English)

2. **NO unnecessary output:**
   - NO long prefaces or introductions
   - NO repeating the question
   - NO generic theory unless directly relevant
   - NO marketing language, emojis, or verbose apologies

3. **Code discipline:**
   - NO placeholders — only final, working code
   - NO tests unless explicitly requested
   - Diff-style for edits; full files only for new ones

## Purpose

Desktop trading terminal for Solana. Manual charting and trading via Jupiter DEX.

Features:
- Candlestick charts with indicators (TradingView lightweight-charts)
- Market/limit swaps via Jupiter Swap API
- Wallet management (import seed phrase / private key, encrypted storage)
- Portfolio tracking with PnL
- Trade history (SQLite)
- Bot mode (deferred, last phase)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron (electron-vite) |
| Frontend | React 18 + TypeScript |
| Build | Vite |
| UI kit | shadcn/ui + Tailwind CSS |
| Charts | TradingView lightweight-charts |
| State | Zustand |
| Local storage | SQLite (better-sqlite3) |
| Blockchain | @solana/kit |
| DEX | Jupiter Swap API v1, Price API v3 |
| Market data | Birdeye API, DexScreener API (fallback) |
| Precision math | decimal.js |

## Codebase from CMIDCABot

This project reuses domain and data layer patterns from `CMIDCABot` (Solana DCA Telegram bot).

**Reused directly:**
- `domain/models/id/` — Branded types (TokenMint, WalletAddress, TxSignature)
- `domain/models/quote/SwapQuote` — Swap quote model
- `domain/policies/SlippagePolicy` — Slippage validation
- `data/sources/api/JupiterSwapClient` — Jupiter Swap API client
- `data/sources/api/JupiterPriceClient` — Jupiter Price API client (extend for arbitrary tokens)
- `data/sources/api/SolanaRpcClient` — Solana RPC (balances, tx signing, keypair gen)
- `data/sources/api/BatchRpcClient` — Batch RPC calls
- `infrastructure/shared/math/Precision` — Decimal arithmetic (toRawAmount, toHumanAmount)
- `infrastructure/shared/resilience/Retry` — Retry with backoff
- `infrastructure/internal/crypto/KeyEncryption` — AES-256-GCM key encryption

**Adapted (different interface, same patterns):**
- Repository interfaces — same pattern, different set of repos
- Use cases — same pattern (single `execute` method), different operations
- Config — adapted for Electron (no Telegram, no DCA scheduling)

**Not reused (bot-specific):**
- `presentation/telegram/` — replaced by React components
- `presentation/commands/` — replaced by UI interactions
- AllocationPolicy — CMI-specific (40/30/30 portfolio)
- DCA scheduling — deferred

## Audience

Developer with Android/Kotlin background, less familiar with TS/JS ecosystem.

## Scope & Boundaries

**Do:**
- TypeScript, Electron, React
- Jupiter API for swaps and prices
- Birdeye/DexScreener for OHLCV candles
- SQLite for trade history and settings
- Solana mainnet (with devnet toggle for testing)
- Iterative development — each phase must be runnable

**Don't:**
- Over-engineered abstractions
- Server-side components (this is a desktop app)
- Multiple blockchain support (Solana only)
- Complex bot strategies in early phases

## Development Phases

1. **Shell + Charts** — Electron shell, sidebar, TradingView charts, Birdeye API
2. **Manual Trading** — Wallet connection, Jupiter swap/limit, balances
3. **Indicators** — SMA/EMA/Bollinger overlays, RSI/MACD panels
4. **Polish** — Portfolio tracking, PnL, SQLite trade history, CSV export
5. **Bot** (last) — Strategy runner, built-in strategies, bot UI

## Useful Links

- [@solana/kit](https://github.com/anza-xyz/solana-web3.js)
- [Jupiter Swap API](https://dev.jup.ag/docs/swap-api)
- [Jupiter Price API](https://dev.jup.ag/docs/price)
- [Birdeye API](https://docs.birdeye.so/)
- [DexScreener API](https://docs.dexscreener.com/)
- [TradingView lightweight-charts](https://tradingview.github.io/lightweight-charts/)
- [electron-vite](https://electron-vite.org/)
- [shadcn/ui](https://ui.shadcn.com/)
