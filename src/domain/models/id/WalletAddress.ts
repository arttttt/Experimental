const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]+$/;

export class WalletAddress {
  public readonly value: string;

  public constructor(value: string) {
    WalletAddress.validate(value);
    this.value = value;
  }

  public equals(other: WalletAddress): boolean {
    return this.value === other.value;
  }

  private static validate(value: string): void {
    if (!BASE58_REGEX.test(value)) {
      throw new Error('WalletAddress must be a base58 string.');
    }

    if (value.length < 32 || value.length > 44) {
      throw new Error('WalletAddress length must be between 32 and 44 characters.');
    }
  }
}
