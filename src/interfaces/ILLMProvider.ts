/**
 * Интерфейс для работы с LLM API.
 *
 * Определяет контракт для всех провайдеров LLM (OpenAI, Anthropic, Ollama, прокси-сервисы).
 * Реализация этого интерфейса должна обрабатывать:
 * - Отправку запросов к API
 * - Обработку ответов (streaming и non-streaming)
 * - Повторные попытки при ошибках
 * - Логирование запросов/ответов
 *
 * @example
 * ```typescript
 * const provider = new LLMProvider(configManager);
 * const response = await provider.generate('Объясни этот код', {
 *   temperature: 0.7,
 *   maxTokens: 1000
 * });
 * console.log(response.content);
 * ```
 */
import { ModelConfig } from './IMultiModelManager';

export interface ILLMProvider {
  /**
   * Генерирует ответ от LLM на основе промпта.
   *
   * @param prompt - Текст запроса (системный промпт + пользовательский запрос)
   * @param options - Опции генерации (температура, максимальное количество токенов, и т.д.)
   * @returns Promise с ответом от LLM
   * @throws {LLMError} Если запрос не удался после всех повторных попыток
   */
  generate(prompt: string, options?: GenerateOptions): Promise<LLMResponse>;

  /**
   * Генерирует ответ от LLM в режиме streaming (поток токенов).
   *
   * @param prompt - Текст запроса
   * @param options - Опции генерации
   * @returns AsyncIterable<string> - поток токенов
   * @throws {LLMError} Если запрос не удался
   */
  generateStream(prompt: string, options?: GenerateOptions): AsyncIterable<string>;

  /**
   * Устанавливает модель для генерации.
   *
   * @param model - Имя модели (например, 'gpt-4o-mini', 'claude-3-opus')
   */
  setModel(model: string): void;

  /**
   * Устанавливает base URL для API.
   *
   * @param url - Base URL (например, 'https://api.openai.com/v1')
   */
  setBaseUrl(url: string): void;

  /**
   * Устанавливает API-ключ для аутентификации.
   *
   * @param key - API-ключ
   */
  setApiKey(key: string): void;

  /**
   * Получает текущую модель.
   *
   * @returns Имя текущей модели
   */
  getModel(): string;

  /**
   * Получает текущий base URL.
   *
   * @returns Base URL API
   */
  getBaseUrl(): string;

  /**
   * Применяет полную конфигурацию модели (baseUrl, apiKey, model, temperature, maxTokens, maxRetries).
   * Используется MultiModelManager для переключения между моделями.
   *
   * @param config - Конфигурация модели из MultiModelManager
   */
  applyModelConfig(config: ModelConfig): void;
}

/**
 * Опции генерации ответа от LLM.
 */
export interface GenerateOptions {
  /**
   * Температура генерации (0.0 - 2.0).
   * Ниже значение = более детерминированный ответ.
   * Выше значение = более креативный ответ.
   * @default 0.7
   */
  temperature?: number;

  /**
   * Максимальное количество токенов в ответе.
   * @default 2000
   */
  maxTokens?: number;

  /**
   * Системный промпт (инструкция для LLM).
   */
  systemPrompt?: string;

  /**
   * Включить режим streaming (поток токенов).
   * @default false
   */
  stream?: boolean;

  /**
   * Top-p (nucleus sampling).
   * Альтернатива temperature.
   * @default 1.0
   */
  topP?: number;

  /**
   * Частотное наказание (frequency penalty).
   * Уменьшает вероятность повторения токенов.
   * @default 0.0
   */
  frequencyPenalty?: number;

  /**
   * Наказание за присутствие (presence penalty).
   * Увеличивает вероятность новых тем.
   * @default 0.0
   */
  presencePenalty?: number;

  /**
   * Таймаут запроса в миллисекундах.
   * @default 60000 (60 секунд)
   */
  timeout?: number;

  /**
   * Количество повторных попыток при ошибке.
   * @default 3
   */
  maxRetries?: number;
}

/**
 * Ответ от LLM.
 */
export interface LLMResponse {
  /**
   * Сгенерированный текст ответа.
   */
  content: string;

  /**
   * Имя модели, которая сгенерировала ответ.
   */
  model: string;

  /**
   * Количество использованных токенов.
   */
  tokensUsed: number;

  /**
   * Причина завершения генерации.
   * - 'stop' - нормальное завершение
   * - 'length' - достигнут лимит токенов
   * - 'content_filter' - сработал фильтр контента
   */
  finishReason: 'stop' | 'length' | 'content_filter' | string;

  /**
   * Дополнительные метаданные ответа.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Ошибка при работе с LLM.
 */
export class LLMError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'LLMError';
  }
}
