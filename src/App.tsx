import { useMemo, useState } from 'react';
import Sidebar, { type ViewName } from './Sidebar';
import { CandlestickChart } from '@/components/chart/CandlestickChart';
import { TokenBalancesPanel } from '@/components/portfolio/TokenBalancesPanel';
import { MarketTokenRegistry } from '@/domain/constants/MarketTokenRegistry';

const VIEW_TITLES: Record<ViewName, string> = {
  Chart: 'Chart View',
  Portfolio: 'Portfolio Overview',
  Settings: 'Workspace Settings',
};

const DEMO_WALLET_ADDRESS =
  typeof import.meta.env.VITE_DEMO_WALLET_ADDRESS === 'string' &&
  import.meta.env.VITE_DEMO_WALLET_ADDRESS.trim().length > 0
    ? import.meta.env.VITE_DEMO_WALLET_ADDRESS.trim()
    : '6QWeT6FpJrm8AF1btu6WH2k2Xhq2jRPjZ8M2Wspxt3r9';

function App() {
  const [activeView, setActiveView] = useState<ViewName>('Chart');
  const [selectedTokenSymbol, setSelectedTokenSymbol] = useState<string>(
    MarketTokenRegistry.defaultToken().symbol,
  );
  const availableTokens = MarketTokenRegistry.all();
  const selectedToken = useMemo(
    () => MarketTokenRegistry.bySymbol(selectedTokenSymbol),
    [selectedTokenSymbol],
  );

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col md:flex-row">
        <Sidebar activeView={activeView} onSelectView={setActiveView} />

        <section className="flex-1 p-5 md:p-8">
          <header className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl shadow-slate-950/40 md:p-6">
            <p className="text-xs uppercase tracking-[0.18em] text-cyan-400">Solana Trading Terminal</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-50 md:text-3xl">{VIEW_TITLES[activeView]}</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              Base layout is in place: sidebar navigation and a main workspace area ready for market
              widgets, positions, and order flow.
            </p>
          </header>

          <article className="mt-5 rounded-xl border border-slate-800 bg-slate-900/50 p-5 shadow-lg shadow-slate-950/30 md:mt-6 md:p-7">
            {activeView === 'Chart' ? (
              <CandlestickChart
                poolAddress={selectedToken.poolAddress}
                tokenMint={selectedToken.mint.value}
                selectedTokenSymbol={selectedTokenSymbol}
                availableTokens={availableTokens.map((token) => ({
                  symbol: token.symbol,
                  name: token.name,
                }))}
                onTokenChange={setSelectedTokenSymbol}
              />
            ) : activeView === 'Portfolio' ? (
              <TokenBalancesPanel walletAddress={DEMO_WALLET_ADDRESS} />
            ) : (
              <>
                <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Main content</p>
                <div className="mt-4 rounded-lg border border-dashed border-slate-700/90 bg-slate-950/60 p-6 text-sm text-slate-300">
                  {activeView} screen placeholder. Integrate feature-specific modules in the next steps.
                </div>
              </>
            )}
          </article>
        </section>
      </div>
    </main>
  );
}

export default App;
