import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  details?: unknown;
}

/**
 * Logger — централизованное логирование для расширения Devil.
 * 
 * Сигнатура методов: logger.error(message, details?, module?)
 * - message: основное сообщение
 * - details: опциональные детали ошибки (любой тип, включая Error, unknown)
 * - module: опциональное имя модуля для фильтрации
 * 
 * Совместимо со всеми существующими вызовами в коде:
 *   logger.error('Сообщение', error, 'ModuleName')
 *   logger.error('Сообщение', 'ModuleName')
 *   logger.error('Сообщение')
 */
export class Logger {
  private outputChannel: vscode.OutputChannel;
  private logLevel: LogLevel;
  private logFilePath: string | null;
  private logBuffer: LogEntry[] = [];
  private debugEnabled: boolean;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Devil');
    this.logLevel = LogLevel.INFO;
    this.logFilePath = null;
    this.debugEnabled = false;
  }

  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  setDebugEnabled(enabled: boolean): void {
    this.debugEnabled = enabled;
    if (enabled) {
      this.logLevel = LogLevel.DEBUG;
    } else {
      this.logLevel = LogLevel.INFO;
    }
  }

  setLogFilePath(projectPath: string): void {
    const devilPath = path.join(projectPath, '.devil');
    const logsPath = path.join(devilPath, 'logs');
    
    if (!fs.existsSync(logsPath)) {
      fs.mkdirSync(logsPath, { recursive: true });
    }
    
    this.logFilePath = path.join(logsPath, `devil-${Date.now()}.log`);
  }

  debug(message: string, details?: unknown, module?: string): void {
    this.log(LogLevel.DEBUG, module || 'Unknown', message, details);
  }

  info(message: string, details?: unknown, module?: string): void {
    this.log(LogLevel.INFO, module || 'Unknown', message, details);
  }

  warn(message: string, details?: unknown, module?: string): void {
    this.log(LogLevel.WARN, module || 'Unknown', message, details);
  }

  error(message: string, details?: unknown, module?: string): void {
    this.log(LogLevel.ERROR, module || 'Unknown', message, details);
  }

  private log(level: LogLevel, module: string, message: string, details?: unknown): void {
    if (level < this.logLevel) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      details
    };

    // Форматированный вывод в VS Code Output Channel
    const levelStr = LogLevel[level];
    const formattedMessage = `[${entry.timestamp}] [${levelStr}] [${module}] ${message}`;
    this.outputChannel.appendLine(formattedMessage);

    if (details !== undefined) {
      const detailsStr = details instanceof Error 
        ? `${details.message}\n${details.stack || ''}` 
        : JSON.stringify(details, null, 2);
      this.outputChannel.appendLine(detailsStr);
    }

    // Буферизация для записи в файл
    this.logBuffer.push(entry);

    // Сброс буфера при достижении размера
    if (this.logBuffer.length >= 10 && this.logFilePath) {
      this.flushToFile();
    }
  }

  private flushToFile(): void {
    if (!this.logFilePath || this.logBuffer.length === 0) return;

    try {
      const content = this.logBuffer.map(entry => JSON.stringify(entry)).join('\n');
      fs.appendFileSync(this.logFilePath, content + '\n');
      this.logBuffer = [];
    } catch {
      // Не логируем ошибки записи, чтобы избежать бесконечного цикла
    }
  }

  show(): void {
    this.outputChannel.show();
  }

  dispose(): void {
    this.flushToFile();
    this.outputChannel.dispose();
  }
}

export const logger = new Logger();
