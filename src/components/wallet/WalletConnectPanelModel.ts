export class WalletConnectPanelModel {
  public static canCreate(password: string, isSubmitting: boolean): boolean {
    return password.trim().length > 0 && !isSubmitting;
  }

  public static canImport(secret: string, password: string, isSubmitting: boolean): boolean {
    return secret.trim().length > 0 && password.trim().length > 0 && !isSubmitting;
  }

  public static canUnlock(password: string, isSubmitting: boolean): boolean {
    return password.trim().length > 0 && !isSubmitting;
  }

  public static shortAddress(address: string): string {
    if (address.length <= 10) {
      return address;
    }

    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  }
}
