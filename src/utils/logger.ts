import * as vscode from 'vscode';

/**
 * Централизованный логгер для расширения Devil.
 * 
 * Все логи выводятся в Output Channel "Devil", который пользователь
 * может открыть через View → Output → Devil.
 * 
 * Уровни логирования:
 * - DEBUG: детальная отладочная информация (включается флагом в конфиге)
 * - INFO:  обычные информационные сообщения
 * - WARN:  предупреждения (некритичные проблемы)
 * - ERROR: ошибки, требующие внимания
 */
class Logger {
  private outputChannel: vscode.OutputChannel;
  private debugEnabled: boolean = false;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Devil');
  }

  /**
   * Включает/выключает DEBUG-логи.
   */
  setDebugEnabled(enabled: boolean): void {
    this.debugEnabled = enabled;
  }

  /**
   * Показывает Output Channel пользователю.
   */
  show(): void {
    this.outputChannel.show(true);
  }

  /**
   * Форматирует сообщение с временной меткой.
   */
  private format(level: string, message: string, context?: string): string {
    const timestamp = new Date().toISOString();
    const ctx = context ? `[${context}] ` : '';
    return `[${timestamp}] [${level}] ${ctx}${message}`;
  }

  debug(message: string, context?: string): void {
    if (this.debugEnabled) {
      this.outputChannel.appendLine(this.format('DEBUG', message, context));
    }
  }

  info(message: string, context?: string): void {
    this.outputChannel.appendLine(this.format('INFO', message, context));
  }

  warn(message: string, context?: string): void {
    this.outputChannel.appendLine(this.format('WARN', message, context));
  }

  error(message: string, error?: unknown, context?: string): void {
    const errorMessage = error instanceof Error ? `: ${error.message}` : '';
    this.outputChannel.appendLine(this.format('ERROR', message + errorMessage, context));
    if (error instanceof Error && error.stack) {
      this.outputChannel.appendLine(error.stack);
    }
  }

  /**
   * Освобождает ресурсы (вызывается при деактивации расширения).
   */
  dispose(): void {
    this.outputChannel.dispose();
  }
}

// Singleton-экземпляр логгера
export const logger = new Logger();
