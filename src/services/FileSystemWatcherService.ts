import * as vscode from 'vscode';
import { logger } from '../utils/logger';

export type FileChangeEvent = 'create' | 'change' | 'delete';

export interface FileChange {
  type: FileChangeEvent;
  path: string;
}

type FileChangeCallback = (change: FileChange) => void;

/**
 * FileSystemWatcherService — обёртка над VS Code FileSystemWatcher.
 * 
 * Отвечает за:
 * - Отслеживание изменений файлов в проекте
 * - Debounce событий (500мс) для автосохранения
 * - Фильтрация по расширениям (только TS/JS)
 * - Уведомление подписчиков об изменениях
 */
export class FileSystemWatcherService {
  private watcher: vscode.FileSystemWatcher | null = null;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private callbacks: FileChangeCallback[] = [];
  private debounceMs: number = 500;
  private allowedExtensions: Set<string> = new Set(['.ts', '.tsx', '.js', '.jsx']);

  constructor(debounceMs: number = 500) {
    this.debounceMs = debounceMs;
    logger.info('FileSystemWatcherService создан (debounce: ' + debounceMs + 'мс)', 'FileSystemWatcherService');
  }

  /**
   * Запускает watcher для проекта.
   */
  start(projectPath: string): void {
    if (this.watcher) {
      this.stop();
    }

    const pattern = new vscode.RelativePattern(projectPath, '**/*');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

    this.watcher.onDidCreate((uri) => this.handleFileEvent('create', uri.fsPath));
    this.watcher.onDidChange((uri) => this.handleFileEvent('change', uri.fsPath));
    this.watcher.onDidDelete((uri) => this.handleFileEvent('delete', uri.fsPath));

    logger.info('Watcher запущен для проекта: ' + projectPath, 'FileSystemWatcherService');
  }

  /**
   * Останавливает watcher.
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.dispose();
      this.watcher = null;
      
      this.debounceTimers.forEach(timer => clearTimeout(timer));
      this.debounceTimers.clear();

      logger.info('Watcher остановлен', 'FileSystemWatcherService');
    }
  }

  /**
   * Подписывается на изменения файлов.
   */
  onFileChange(callback: FileChangeCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Обрабатывает событие файла с debounce.
   */
  private handleFileEvent(type: FileChangeEvent, filePath: string): void {
    const ext = this.getFileExtension(filePath);
    if (!this.allowedExtensions.has(ext)) {
      return;
    }

    const existingTimer = this.debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.notifyCallbacks({ type, path: filePath });
    }, this.debounceMs);

    this.debounceTimers.set(filePath, timer);
  }

  /**
   * Уведомляет подписчиков об изменении.
   */
  private notifyCallbacks(change: FileChange): void {
    logger.debug('Изменение файла: ' + change.type + ' ' + change.path, 'FileSystemWatcherService');
    
    for (const callback of this.callbacks) {
      try {
        callback(change);
      } catch (error) {
        logger.error('Ошибка в callback FileSystemWatcher', error, 'FileSystemWatcherService');
      }
    }
  }

  /**
   * Получает расширение файла.
   */
  private getFileExtension(filePath: string): string {
    const lastDot = filePath.lastIndexOf('.');
    if (lastDot === -1) return '';
    return filePath.substring(lastDot).toLowerCase();
  }

  /**
   * Освобождает ресурсы.
   */
  dispose(): void {
    this.stop();
    this.callbacks = [];
  }
}
