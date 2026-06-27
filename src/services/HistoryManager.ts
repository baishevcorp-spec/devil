import { IMemoryStore, DialogMessage, DialogRole } from '../interfaces/IMemoryStore';
import { logger } from '../utils/logger';

/**
 * HistoryManager — управление историей диалогов через MemoryStore.
 *
 * Отвечает за:
 * - Сохранение сообщений в таблицу dialog_history
 * - Загрузку истории при открытии проекта
 * - Ограничение размера истории (последние 100 сообщений)
 *
 * Все данные хранятся в .devil/memory.db (таблица dialog_history).
 */
export class HistoryManager {
  private projectPath: string = '';
  private maxMessages: number = 100;

  constructor(private readonly memoryStore: IMemoryStore) {
    logger.info('HistoryManager инициализирован (через MemoryStore)', 'HistoryManager');
  }

  /**
   * Инициализирует HistoryManager для проекта.
   */
  async initialize(projectPath: string): Promise<void> {
    this.projectPath = projectPath;
    logger.info('HistoryManager привязан к проекту: ' + projectPath, 'HistoryManager');
  }

  /**
   * Добавляет сообщение в историю.
   */
  async addMessage(
    role: DialogRole,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (!this.projectPath) {
      logger.warn('HistoryManager не инициализирован, сообщение не сохранено', 'HistoryManager');
      return;
    }

    try {
      await this.memoryStore.addDialogMessage({
        project_path: this.projectPath,
        role,
        content,
        metadata: metadata || {},
      });

      logger.debug('Сообщение добавлено в историю: ' + role, 'HistoryManager');
    } catch (error) {
      logger.error('Не удалось сохранить сообщение в историю', error, 'HistoryManager');
    }
  }

  /**
   * Получает все сообщения из истории.
   */
  async getMessages(): Promise<DialogMessage[]> {
    if (!this.projectPath) {
      return [];
    }

    try {
      return await this.memoryStore.getDialogHistory({
        project_path: this.projectPath,
        limit: this.maxMessages,
      });
    } catch (error) {
      logger.error('Не удалось загрузить историю', error, 'HistoryManager');
      return [];
    }
  }

  /**
   * Получает последние N сообщений.
   */
  async getRecentMessages(limit: number = 10): Promise<DialogMessage[]> {
    if (!this.projectPath) {
      return [];
    }

    try {
      return await this.memoryStore.getDialogHistory({
        project_path: this.projectPath,
        limit,
      });
    } catch (error) {
      logger.error('Не удалось загрузить последние сообщения', error, 'HistoryManager');
      return [];
    }
  }

  /**
   * Очищает историю.
   */
  async clearHistory(): Promise<void> {
    if (!this.projectPath) {
      return;
    }

    try {
      await this.memoryStore.clearDialogHistory(this.projectPath);
      logger.info('История очищена', 'HistoryManager');
    } catch (error) {
      logger.error('Не удалось очистить историю', error, 'HistoryManager');
    }
  }

  /**
   * Устанавливает путь к проекту.
   */
  setProjectPath(projectPath: string): void {
    this.projectPath = projectPath;
  }
}
