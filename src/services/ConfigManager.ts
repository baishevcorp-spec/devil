import * as vscode from 'vscode';
import { ConfigError } from '../utils/errors';
import { logger } from '../utils/logger';

/**
 * Конфигурация расширения Devil.
 * Все поля соответствуют ключам в contributes.configuration в package.json.
 */
export interface DevilConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxRetries: number;
  cacheTtlSeconds: number;
  defaultSystemPrompt: string;
  debugMode: boolean;
}

/**
 * Значения по умолчанию (используются, если в settings.json не указаны).
 */
const DEFAULT_CONFIG: DevilConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  maxRetries: 3,
  cacheTtlSeconds: 604800, // 7 дней
  defaultSystemPrompt:
    'Ты — Devil, интеллектуальный ассистент для разработчика. ' +
    'Отвечай на русском языке, кратко и по делу. ' +
    'Используй Markdown для форматирования, блоки кода — с указанием языка.',
  debugMode: false
};

/**
 * ConfigManager — единая точка доступа к настройкам расширения.
 * 
 * Отвечает за:
 * - Чтение настроек из `vscode.workspace.getConfiguration('devil')`
 * - Подписку на изменения настроек (onConfigChanged)
 * - Валидацию конфигурации
 * - Предоставление значений по умолчанию
 * 
 * @example
 * ```typescript
 * const config = new ConfigManager();
 * config.initialize();
 * 
 * const url = config.getBaseUrl();
 * config.onConfigChanged(() => {
 *   console.log('Настройки изменились!');
 * });
 * ```
 */
export class ConfigManager {
  private disposables: vscode.Disposable[] = [];
  private changeListeners: Array<() => void> = [];

  /**
   * Инициализирует ConfigManager и подписывается на изменения настроек.
   * Должен быть вызван при активации расширения.
   */
  initialize(): void {
    const subscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('devil')) {
        logger.info('Конфигурация devil изменена', 'ConfigManager');
        this.notifyListeners();
      }
    });
    this.disposables.push(subscription);

    // Синхронизируем debugMode с логгером
    if (this.getDebugMode()) { logger.setLogLevel(0); } else { logger.setLogLevel(1); }

    logger.info('ConfigManager инициализирован', 'ConfigManager');
  }

  /**
   * Возвращает всю конфигурацию в виде объекта.
   */
  getConfig(): DevilConfig {
    const cfg = vscode.workspace.getConfiguration('devil');
    return {
      baseUrl: cfg.get<string>('baseUrl', DEFAULT_CONFIG.baseUrl),
      apiKey: cfg.get<string>('apiKey', DEFAULT_CONFIG.apiKey),
      model: cfg.get<string>('model', DEFAULT_CONFIG.model),
      maxRetries: cfg.get<number>('maxRetries', DEFAULT_CONFIG.maxRetries),
      cacheTtlSeconds: cfg.get<number>('cacheTtlSeconds', DEFAULT_CONFIG.cacheTtlSeconds),
      defaultSystemPrompt: cfg.get<string>('defaultSystemPrompt', DEFAULT_CONFIG.defaultSystemPrompt),
      debugMode: cfg.get<boolean>('debugMode', DEFAULT_CONFIG.debugMode)
    };
  }

  getBaseUrl(): string {
    return this.getConfig().baseUrl;
  }

  getApiKey(): string {
    return this.getConfig().apiKey;
  }

  getModel(): string {
    return this.getConfig().model;
  }

  getMaxRetries(): number {
    return this.getConfig().maxRetries;
  }

  getCacheTtlSeconds(): number {
    return this.getConfig().cacheTtlSeconds;
  }

  getDefaultSystemPrompt(): string {
    return this.getConfig().defaultSystemPrompt;
  }

  getDebugMode(): boolean {
    return this.getConfig().debugMode;
  }

  /**
   * Проверяет, что конфигурация валидна для работы с LLM.
   * @throws ConfigError если критичные поля не заполнены
   */
  validate(): void {
    const config = this.getConfig();

    if (!config.baseUrl || config.baseUrl.trim() === '') {
      throw new ConfigError(
        'baseUrl is empty',
        'Не указан URL API. Откройте настройки: Devil → Base URL.'
      );
    }

    if (!config.apiKey || config.apiKey.trim() === '') {
      throw new ConfigError(
        'apiKey is empty',
        'Не указан API-ключ. Откройте настройки: Devil → Api Key.'
      );
    }

    if (!config.model || config.model.trim() === '') {
      throw new ConfigError(
        'model is empty',
        'Не указана модель. Откройте настройки: Devil → Model.'
      );
    }

    if (config.maxRetries < 0 || config.maxRetries > 10) {
      throw new ConfigError(
        `maxRetries out of range: ${config.maxRetries}`,
        'Значение maxRetries должно быть от 0 до 10.'
      );
    }
  }

  /**
   * Проверяет валидность без выбрасывания исключения.
   * @returns true если конфигурация валидна
   */
  isValid(): boolean {
    try {
      this.validate();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Регистрирует слушателя изменений конфигурации.
   * @returns Disposable для отписки
   */
  onConfigChanged(listener: () => void): vscode.Disposable {
    this.changeListeners.push(listener);
    return new vscode.Disposable(() => {
      this.changeListeners = this.changeListeners.filter((l) => l !== listener);
    });
  }

  private notifyListeners(): void {
    // Синхронизируем debugMode с логгером при каждом изменении
    if (this.getDebugMode()) { logger.setLogLevel(0); } else { logger.setLogLevel(1); }

    for (const listener of this.changeListeners) {
      try {
        listener();
      } catch (error) {
        logger.error('Ошибка в слушателе onConfigChanged', error, 'ConfigManager');
      }
    }
  }

  /**
   * Освобождает ресурсы. Вызывается при деактивации расширения.
   */
  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
    this.changeListeners = [];
    logger.info('ConfigManager остановлен', 'ConfigManager');
  }
}
