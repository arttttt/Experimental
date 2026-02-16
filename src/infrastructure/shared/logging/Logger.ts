export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  public static debug(message: string, context?: Record<string, unknown>): void {
    Logger.write('debug', message, context);
  }

  public static info(message: string, context?: Record<string, unknown>): void {
    Logger.write('info', message, context);
  }

  public static warn(message: string, context?: Record<string, unknown>): void {
    Logger.write('warn', message, context);
  }

  public static error(message: string, context?: Record<string, unknown>): void {
    Logger.write('error', message, context);
  }

  private static write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}]`;

    if (!context || Object.keys(context).length === 0) {
      Logger.print(level, `${prefix} ${message}`);
      return;
    }

    Logger.print(level, `${prefix} ${message}`, context);
  }

  private static print(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    switch (level) {
      case 'debug':
        console.debug(message, context ?? '');
        break;
      case 'info':
        console.info(message, context ?? '');
        break;
      case 'warn':
        console.warn(message, context ?? '');
        break;
      case 'error':
        console.error(message, context ?? '');
        break;
      default:
        console.log(message, context ?? '');
    }
  }
}
