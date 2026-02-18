export type WalletCryptoApi = Readonly<{
  encrypt: (plaintext: string, password: string) => Promise<string>;
  decrypt: (encryptedBase64: string, password: string) => Promise<string>;
}>;

export const ipc = {
  crypto: {
    encrypt: (plaintext: string, password: string) => {
      return window.walletCrypto.encrypt(plaintext, password);
    },
    decrypt: (encryptedBase64: string, password: string) => {
      return window.walletCrypto.decrypt(encryptedBase64, password);
    },
  } satisfies WalletCryptoApi,
} as const;
