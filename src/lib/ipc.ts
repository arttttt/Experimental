export type WalletCryptoApi = Readonly<{
  encrypt: (plaintext: string, password: string) => Promise<string>;
  decrypt: (encryptedBase64: string, password: string) => Promise<string>;
}>;

const WALLET_CRYPTO_UNAVAILABLE_ERROR =
  'Wallet crypto API is unavailable. Use the Electron app shell to access secure key operations.';

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

export const ipc = {
  crypto: {
    encrypt: async (plaintext: string, password: string) => {
      return walletCryptoApiOrThrow().encrypt(plaintext, password);
    },
    decrypt: async (encryptedBase64: string, password: string) => {
      return walletCryptoApiOrThrow().decrypt(encryptedBase64, password);
    },
  } satisfies WalletCryptoApi,
} as const;
