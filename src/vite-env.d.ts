/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BIRDEYE_API_KEY?: string;
  readonly VITE_DEMO_WALLET_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
