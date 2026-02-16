function App() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <section className="mx-auto max-w-3xl rounded-xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl shadow-slate-950/50">
        <p className="text-xs uppercase tracking-[0.18em] text-cyan-400">Solana Trading Terminal</p>
        <h1 className="mt-3 text-3xl font-semibold text-slate-50">Electron scaffold is ready</h1>
        <p className="mt-3 max-w-2xl text-sm text-slate-300">
          React + TypeScript + Electron Vite are configured. Next phases will wire market data,
          wallet flows, and trading execution.
        </p>

        <div className="mt-6 rounded-lg border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-sm text-slate-200">Run the app:</p>
          <code className="mt-2 block rounded bg-slate-900 px-3 py-2 text-sm text-cyan-300">
            npm install && npm run dev
          </code>
        </div>
      </section>
    </main>
  );
}

export default App;
