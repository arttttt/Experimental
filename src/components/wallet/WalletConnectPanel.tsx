import { useMemo, useState } from 'react';

import { WalletConnectPanelModel } from '@/components/wallet/WalletConnectPanelModel';
import { WalletManager } from '@/features/wallet/WalletManager';

type ImportMode = 'mnemonic' | 'privateKey';

type WalletSession = Readonly<{
  address: string;
  encryptedKey: string;
  isLocked: boolean;
}>;

function WalletConnectPanel() {
  const walletManager = useMemo(() => new WalletManager(), []);
  const [importMode, setImportMode] = useState<ImportMode>('mnemonic');

  const [createPassword, setCreatePassword] = useState<string>('');
  const [importSecret, setImportSecret] = useState<string>('');
  const [importPassword, setImportPassword] = useState<string>('');
  const [unlockPassword, setUnlockPassword] = useState<string>('');

  const [walletSession, setWalletSession] = useState<WalletSession | null>(null);
  const [createdMnemonic, setCreatedMnemonic] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = WalletConnectPanelModel.canCreate(createPassword, isSubmitting);
  const canImport = WalletConnectPanelModel.canImport(importSecret, importPassword, isSubmitting);
  const canUnlock = WalletConnectPanelModel.canUnlock(unlockPassword, isSubmitting);

  const handleCreateWallet = async (): Promise<void> => {
    setIsSubmitting(true);
    setError(null);

    try {
      const generatedWallet = await walletManager.generateWallet(createPassword);

      setWalletSession({
        address: generatedWallet.address.value,
        encryptedKey: generatedWallet.encryptedKey,
        isLocked: false,
      });
      setCreatedMnemonic(generatedWallet.mnemonic);
      setCreatePassword('');
      setUnlockPassword('');
    } catch (reason) {
      setError(getErrorMessage(reason, 'Failed to create wallet.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleImportWallet = async (): Promise<void> => {
    setIsSubmitting(true);
    setError(null);

    try {
      const importedWallet =
        importMode === 'mnemonic'
          ? await walletManager.importFromSeed(importSecret, importPassword)
          : await walletManager.importFromPrivateKey(importSecret, importPassword);

      setWalletSession({
        address: importedWallet.address.value,
        encryptedKey: importedWallet.encryptedKey,
        isLocked: false,
      });
      setCreatedMnemonic(null);
      setImportSecret('');
      setImportPassword('');
      setUnlockPassword('');
    } catch (reason) {
      setError(getErrorMessage(reason, 'Failed to import wallet.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnlockWallet = async (): Promise<void> => {
    if (walletSession === null) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const address = await walletManager.getAddressFromEncryptedKey(
        walletSession.encryptedKey,
        unlockPassword,
      );

      setWalletSession({
        address: address.value,
        encryptedKey: walletSession.encryptedKey,
        isLocked: false,
      });
      setUnlockPassword('');
    } catch (reason) {
      setError(getErrorMessage(reason, 'Failed to unlock wallet.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const lockWallet = (): void => {
    if (walletSession === null) {
      return;
    }

    setWalletSession({
      ...walletSession,
      isLocked: true,
    });
    setUnlockPassword('');
  };

  const disconnectWallet = (): void => {
    setWalletSession(null);
    setCreatedMnemonic(null);
    setCreatePassword('');
    setImportSecret('');
    setImportPassword('');
    setUnlockPassword('');
    setError(null);
  };

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/65 p-4" aria-label="Wallet connect panel">
      <p className="text-[0.68rem] uppercase tracking-[0.18em] text-cyan-300/90">Wallet</p>
      <p className="mt-1 text-[0.72rem] text-slate-400">
        {walletSession === null
          ? 'Create or import a wallet'
          : walletSession.isLocked
            ? 'Encrypted key is locked'
            : 'Ready for trading actions'}
      </p>

      {walletSession === null ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setImportMode('mnemonic');
                setImportSecret('');
                setError(null);
              }}
              disabled={isSubmitting}
              className={[
                'rounded-md border px-2 py-1.5 text-xs font-medium transition',
                importMode === 'mnemonic'
                  ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-200'
                  : 'border-slate-700 bg-slate-950/40 text-slate-300 hover:border-slate-600 hover:text-slate-100',
              ].join(' ')}
            >
              Import Seed
            </button>
            <button
              type="button"
              onClick={() => {
                setImportMode('privateKey');
                setImportSecret('');
                setError(null);
              }}
              disabled={isSubmitting}
              className={[
                'rounded-md border px-2 py-1.5 text-xs font-medium transition',
                importMode === 'privateKey'
                  ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-200'
                  : 'border-slate-700 bg-slate-950/40 text-slate-300 hover:border-slate-600 hover:text-slate-100',
              ].join(' ')}
            >
              Import Key
            </button>
          </div>

          <div className="mt-3 space-y-2">
            <label htmlFor="wallet-secret-input" className="sr-only">
              Wallet secret
            </label>
            <textarea
              id="wallet-secret-input"
              value={importSecret}
              onChange={(event) => setImportSecret(event.target.value)}
              rows={importMode === 'mnemonic' ? 2 : 1}
              disabled={isSubmitting}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={
                importMode === 'mnemonic'
                  ? 'Seed phrase: word1 word2 ...'
                  : 'Private key (base58 or base64)'
              }
              className="w-full resize-none rounded-md border border-slate-700 bg-slate-950/60 px-2 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/60 focus:outline-none"
            />
            <label htmlFor="wallet-import-password" className="sr-only">
              Import password
            </label>
            <input
              id="wallet-import-password"
              type="password"
              value={importPassword}
              onChange={(event) => setImportPassword(event.target.value)}
              disabled={isSubmitting}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Encryption password"
              className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-2 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/60 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                void handleImportWallet();
              }}
              disabled={!canImport}
              className="w-full rounded-md border border-cyan-500/60 bg-cyan-500/15 px-2 py-2 text-xs font-medium text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Connecting...' : 'Connect Imported Wallet'}
            </button>
          </div>

          <div className="mt-4 border-t border-slate-800 pt-3">
            <p className="text-[0.68rem] uppercase tracking-[0.14em] text-slate-400">Create New</p>
            <div className="mt-2 space-y-2">
              <label htmlFor="wallet-create-password" className="sr-only">
                Create wallet password
              </label>
              <input
                id="wallet-create-password"
                type="password"
                value={createPassword}
                onChange={(event) => setCreatePassword(event.target.value)}
                disabled={isSubmitting}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Encryption password"
                className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-2 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/60 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  void handleCreateWallet();
                }}
                disabled={!canCreate}
                className="w-full rounded-md border border-slate-600 bg-slate-800 px-2 py-2 text-xs font-medium text-slate-100 transition hover:border-slate-500 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? 'Creating...' : 'Create and Connect'}
              </button>
            </div>
          </div>
        </>
      ) : walletSession.isLocked ? (
        <div className="mt-3 space-y-3">
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-2 text-xs text-amber-100">
            Wallet locked: {shortAddress(walletSession.address)}
          </div>
          <p className="font-mono text-[0.68rem] text-slate-400">{walletSession.address}</p>
          <label htmlFor="wallet-unlock-password" className="sr-only">
            Unlock password
          </label>
          <input
            id="wallet-unlock-password"
            type="password"
            value={unlockPassword}
            onChange={(event) => setUnlockPassword(event.target.value)}
            disabled={isSubmitting}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Password to unlock"
            className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-2 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/60 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => {
              void handleUnlockWallet();
            }}
            disabled={!canUnlock}
            className="w-full rounded-md border border-cyan-500/60 bg-cyan-500/15 px-2 py-2 text-xs font-medium text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Unlocking...' : 'Unlock Wallet'}
          </button>
          <button
            type="button"
            onClick={disconnectWallet}
            disabled={isSubmitting}
            className="w-full rounded-md border border-slate-700 bg-slate-950/40 px-2 py-2 text-xs text-slate-300 transition hover:border-slate-600 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-2 text-xs text-emerald-100">
            Connected: {shortAddress(walletSession.address)}
          </div>
          <p className="font-mono text-[0.68rem] text-slate-400">{walletSession.address}</p>

          {createdMnemonic !== null ? (
            <div className="rounded-md border border-fuchsia-500/35 bg-fuchsia-500/10 px-2 py-2 text-[0.68rem] leading-5 text-fuchsia-100">
              Save recovery phrase now:
              <div className="mt-1 break-words font-mono text-[0.72rem] text-fuchsia-50">{createdMnemonic}</div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={lockWallet}
              className="rounded-md border border-slate-600 bg-slate-800 px-2 py-2 text-xs text-slate-100 transition hover:border-slate-500 hover:bg-slate-700"
            >
              Lock
            </button>
            <button
              type="button"
              onClick={disconnectWallet}
              className="rounded-md border border-slate-700 bg-slate-950/40 px-2 py-2 text-xs text-slate-300 transition hover:border-slate-600 hover:text-slate-100"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}

      {error !== null ? (
        <p className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-2 text-xs text-rose-100">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function shortAddress(address: string): string {
  return WalletConnectPanelModel.shortAddress(address);
}

function getErrorMessage(reason: unknown, fallback: string): string {
  if (reason instanceof Error) {
    return reason.message;
  }

  return fallback;
}

export default WalletConnectPanel;
