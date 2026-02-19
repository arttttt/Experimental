import WalletConnectPanel from '@/components/wallet/WalletConnectPanel';

const VIEWS = ['Chart', 'Swap', 'Portfolio', 'Limit Orders', 'Settings'] as const;

export type ViewName = (typeof VIEWS)[number];

type SidebarProps = {
  activeView: ViewName;
  onSelectView: (view: ViewName) => void;
};

function Sidebar({ activeView, onSelectView }: SidebarProps) {
  return (
    <aside className="w-full border-b border-slate-800 bg-slate-950/85 backdrop-blur md:flex md:w-72 md:flex-col md:border-b-0 md:border-r">
      <div className="px-5 py-5 md:px-6 md:py-7">
        <p className="text-[0.7rem] uppercase tracking-[0.2em] text-cyan-300/90">Furiosa Terminal</p>
        <h1 className="mt-2 text-xl font-semibold text-slate-50">Solana Desk</h1>
      </div>

      <nav className="px-3 pb-4 md:px-4 md:pb-6" aria-label="Primary">
        <ul className="grid grid-cols-2 gap-2 md:grid-cols-1">
          {VIEWS.map((view) => {
            const isActive = view === activeView;

            return (
              <li key={view}>
                <button
                  type="button"
                  onClick={() => onSelectView(view)}
                  className={[
                    'group flex w-full items-center justify-center rounded-lg border px-3 py-2 text-sm transition md:justify-start',
                    isActive
                      ? 'border-cyan-400/60 bg-cyan-500/10 text-cyan-200 shadow-inner shadow-cyan-500/10'
                      : 'border-slate-800 bg-slate-900/40 text-slate-300 hover:border-slate-700 hover:bg-slate-900/70 hover:text-slate-100',
                  ].join(' ')}
                >
                  {view}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="px-3 pb-5 md:mt-auto md:px-4 md:pb-6">
        <WalletConnectPanel />
      </div>
    </aside>
  );
}

export default Sidebar;
