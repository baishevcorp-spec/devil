import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger';

/**
 * Сообщение в истории диалога.
 */
export interface DialogMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: {
    tokensUsed?: number;
    model?: string;
    command?: string;
  };
}

/**
 * История диалога для проекта.
 */
export interface DialogHistory {
  projectPath: string;
  messages: DialogMessage[];
  lastUpdated: number;
}

/**
 * HistoryManager — управление историей диалогов.
 * 
 * Отвечает за:
 * - Сохранение сообщений в .devil/history.json
 * - Загрузку истории при открытии проекта
 * - Ограничение размера истории (последние 100 сообщений)
 */
export class HistoryManager {
  private history: DialogHistory | null = null;
  private historyPath: string = '';
  private maxMessages: number = 100;

  /**
   * Инициализирует HistoryManager для проекта.
   */
  async initialize(projectPath: string): Promise<void> {
    const devilPath = path.join(projectPath, '.devil');
    this.historyPath = path.join(devilPath, 'history.json');

    // Создаём папку .devil, если её нет
    await fs.mkdir(devilPath, { recursive: true });

    // Загружаем историю, если она есть
    await this.loadHistory();

    logger.info('HistoryManager инициализирован для проекта: ' + projectPath, 'HistoryManager');
  }

  /**
   * Загружает историю из файла.
   */
  private async loadHistory(): Promise<void> {
    try {
      const exists = await this.fileExists(this.historyPath);
      if (exists) {
        const content = await fs.readFile(this.historyPath, 'utf-8');
        this.history = JSON.parse(content);
        logger.info('История загружена (' + (this.history?.messages.length || 0) + ' сообщений)', 'HistoryManager');
      } else {
        this.history = null;
        logger.info('История не найдена, будет создана новая', 'HistoryManager');
      }
    } catch (error) {
      logger.error('Не удалось загрузить историю', error, 'HistoryManager');
      this.history = null;
    }
  }

  /**
   * Сохраняет историю в файл.
   */
  private async saveHistory(): Promise<void> {
    if (!this.history) return;

    try {
      // Ограничиваем размер истории
      if (this.history.messages.length > this.maxMessages) {
        this.history.messages = this.history.messages.slice(-this.maxMessages);
      }

      this.history.lastUpdated = Date.now();
      await fs.writeFile(this.historyPath, JSON.stringify(this.history, null, 2), 'utf-8');
      logger.debug('История сохранена', 'HistoryManager');
    } catch (error) {
      logger.error('Не удалось сохранить историю', error, 'HistoryManager');
    }
  }

  /**
   * Добавляет сообщение в историю.
   */
  async addMessage(
    role: DialogMessage['role'],
    content: string,
    metadata?: DialogMessage['metadata']
  ): Promise<void> {
    if (!this.history) {
      this.history = {
        projectPath: '',
        messages: [],
        lastUpdated: Date.now()
      };
    }

    const message: DialogMessage = {
      id: this.generateId(),
      role,
      content,
      timestamp: Date.now(),
      metadata
    };

    this.history.messages.push(message);
    await this.saveHistory();

    logger.debug('Сообщение добавлено в историю: ' + role, 'HistoryManager');
  }

  /**
   * Получает все сообщения из истории.
   */
  getMessages(): DialogMessage[] {
    return this.history?.messages || [];
  }

  /**
   * Получает последние N сообщений.
   */
  getRecentMessages(limit: number = 10): DialogMessage[] {
    const messages = this.getMessages();
    return messages.slice(-limit);
  }

  /**
   * Очищает историю.
   */
  async clearHistory(): Promise<void> {
    if (this.history) {
      this.history.messages = [];
      await this.saveHistory();
      logger.info('История очищена', 'HistoryManager');
    }
  }

  /**
   * Проверяет существование файла.
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Генерирует уникальный ID для сообщения.
   */
  private generateId(): string {
    return 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(7);
  }

  /**
   * Устанавливает путь к проекту.
   */
  setProjectPath(projectPath: string): void {
    if (this.history) {
      this.history.projectPath = projectPath;
    }
  }
}
