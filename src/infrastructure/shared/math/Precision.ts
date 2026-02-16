import Decimal from 'decimal.js';

export class Precision {
  public static toRawAmount(humanAmount: string | number, decimals: number): string {
    Precision.ensureDecimals(decimals);
    const rawAmount = new Decimal(humanAmount).mul(Precision.tenPow(decimals));

    if (!rawAmount.isInteger()) {
      throw new Error('Raw token amount must be an integer.');
    }

    return rawAmount.toFixed(0);
  }

  public static toHumanAmount(rawAmount: string | number, decimals: number): string {
    Precision.ensureDecimals(decimals);
    return new Decimal(rawAmount).div(Precision.tenPow(decimals)).toString();
  }

  public static add(left: string | number, right: string | number): string {
    return new Decimal(left).add(right).toString();
  }

  public static sub(left: string | number, right: string | number): string {
    return new Decimal(left).sub(right).toString();
  }

  private static tenPow(decimals: number): Decimal {
    return new Decimal(10).pow(decimals);
  }

  private static ensureDecimals(decimals: number): void {
    if (!Number.isInteger(decimals) || decimals < 0) {
      throw new Error('Token decimals must be a non-negative integer.');
    }
  }
}
