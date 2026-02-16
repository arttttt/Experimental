const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]+$/;

export class TxSignature {
  public readonly value: string;

  public constructor(value: string) {
    TxSignature.validate(value);
    this.value = value;
  }

  public equals(other: TxSignature): boolean {
    return this.value === other.value;
  }

  private static validate(value: string): void {
    if (!BASE58_REGEX.test(value)) {
      throw new Error('TxSignature must be a base58 string.');
    }

    if (value.length < 64 || value.length > 88) {
      throw new Error('TxSignature length must be between 64 and 88 characters.');
    }
  }
}
