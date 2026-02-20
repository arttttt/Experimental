// SLIP-0010 Ed25519 HD key derivation (pure ESM, no Node.js Buffer dependency).
// Replaces ed25519-hd-key which crashes Electron renderer via Vite due to
// CommonJS require('buffer') in its transitive dependency chain.

import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha2';
import { hexToBytes, concatBytes } from '@noble/hashes/utils';

const ED25519_CURVE = new TextEncoder().encode('ed25519 seed');
const HARDENED_OFFSET = 0x80000000;
const PATH_REGEX = /^m(\/[0-9]+')+$/;

type DerivedKeys = Readonly<{
  key: Uint8Array;
  chainCode: Uint8Array;
}>;

function getMasterKeyFromSeed(seedHex: string): DerivedKeys {
  const I = hmac(sha512, ED25519_CURVE, hexToBytes(seedHex));
  return {
    key: I.slice(0, 32),
    chainCode: I.slice(32),
  };
}

function childKeyDerivation({ key, chainCode }: DerivedKeys, index: number): DerivedKeys {
  const indexBytes = new Uint8Array(4);
  new DataView(indexBytes.buffer).setUint32(0, index, false);

  const data = concatBytes(new Uint8Array(1), key, indexBytes);
  const I = hmac(sha512, chainCode, data);

  return {
    key: I.slice(0, 32),
    chainCode: I.slice(32),
  };
}

export function derivePath(path: string, seedHex: string): DerivedKeys {
  if (!PATH_REGEX.test(path)) {
    throw new Error('Invalid derivation path');
  }

  const segments = path
    .split('/')
    .slice(1)
    .map((segment) => parseInt(segment.replace("'", ''), 10));

  if (segments.some(isNaN)) {
    throw new Error('Invalid derivation path');
  }

  const master = getMasterKeyFromSeed(seedHex);

  return segments.reduce<DerivedKeys>(
    (parent, segment) => childKeyDerivation(parent, segment + HARDENED_OFFSET),
    master,
  );
}
