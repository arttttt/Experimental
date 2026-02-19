import { describe, expect, it } from 'vitest';

import { WalletConnectPanelModel } from '@/components/wallet/WalletConnectPanelModel';

describe('WalletConnectPanelModel', () => {
  it('enables create/import/unlock only with non-empty input and idle state', () => {
    expect(WalletConnectPanelModel.canCreate('password', false)).toBe(true);
    expect(WalletConnectPanelModel.canCreate('   ', false)).toBe(false);
    expect(WalletConnectPanelModel.canCreate('password', true)).toBe(false);

    expect(WalletConnectPanelModel.canImport('seed words', 'password', false)).toBe(true);
    expect(WalletConnectPanelModel.canImport('', 'password', false)).toBe(false);
    expect(WalletConnectPanelModel.canImport('seed words', '', false)).toBe(false);
    expect(WalletConnectPanelModel.canImport('seed words', 'password', true)).toBe(false);

    expect(WalletConnectPanelModel.canUnlock('password', false)).toBe(true);
    expect(WalletConnectPanelModel.canUnlock(' ', false)).toBe(false);
    expect(WalletConnectPanelModel.canUnlock('password', true)).toBe(false);
  });

  it('shortens long addresses while keeping short ones intact', () => {
    expect(WalletConnectPanelModel.shortAddress('1234567890')).toBe('1234567890');
    expect(WalletConnectPanelModel.shortAddress('12345678901')).toBe('1234...8901');
  });
});
