import axios, { AxiosInstance, AxiosError } from 'axios';
import { ConfigManager } from './ConfigManager';
import { LLMError, NetworkError } from '../utils/errors';
import { logger } from '../utils/logger';
import {
  ILLMProvider,
  GenerateOptions,
  LLMResponse
} from '../interfaces/ILLMProvider';

/**
 * LLMProvider — HTTP-клиент для работы с OpenAI-совместимым API.
 * 
 * Отвечает за:
 * - Отправку запросов к LLM API (generate, generateStream)
 * - Обработку ответов (streaming и non-streaming)
 * - Повторные попытки при ошибках (retry logic)
 * - Логирование запросов/ответов
 * 
 * Поддерживает:
 * - OpenAI API (https://api.openai.com/v1)
 * - Прокси-сервисы (например, https://api.myproxyapi.ru/v1)
 * - Локальные модели (Ollama: http://localhost:11434/v1)
 * 
 * @example
 * ```typescript
 * const configManager = new ConfigManager();
 * const llmProvider = new LLMProvider(configManager);
 * 
 * const response = await llmProvider.generate('Объясни этот код', {
 *   temperature: 0.7,
 *   maxTokens: 1000
 * });
 * 
 * console.log(response.content);
 * console.log(`Использовано токенов: ${response.tokensUsed}`);
 * ```
 */
export class LLMProvider implements ILLMProvider {
  private axiosInstance: AxiosInstance;
  private currentModel: string;
  private currentBaseUrl: string;
  private currentApiKey: string;

  constructor(private readonly configManager: ConfigManager) {
    this.currentModel = configManager.getModel();
    this.currentBaseUrl = this.normalizeUrl(configManager.getBaseUrl());
    this.currentApiKey = configManager.getApiKey();

    this.axiosInstance = axios.create({
      timeout: 60000, // 60 секунд
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Подписываемся на изменения конфигурации
    configManager.onConfigChanged(() => {
      this.currentModel = configManager.getModel();
      this.currentBaseUrl = this.normalizeUrl(configManager.getBaseUrl());
      this.currentApiKey = configManager.getApiKey();
      logger.info('Конфигурация LLM обновлена', 'LLMProvider');
    });

    logger.info('LLMProvider инициализирован', 'LLMProvider');
  }

  /**
   * Генерирует ответ от LLM на основе промпта.
   */
  async generate(prompt: string, options: GenerateOptions = {}): Promise<LLMResponse> {
    const maxRetries = options.maxRetries || this.configManager.getMaxRetries();
    const timeout = options.timeout || 60000;

    logger.info(`Отправка запроса к LLM (модель: ${this.currentModel})`, 'LLMProvider');
    logger.debug(`Промпт: ${prompt.substring(0, 100)}...`, 'LLMProvider');

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.sendRequest(prompt, options, timeout);
        logger.info(`Ответ получен (попытка ${attempt}, токенов: ${response.tokensUsed})`, 'LLMProvider');
        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (error instanceof LLMError && !error.retryable) {
          logger.error(`Неразрешимая ошибка LLM (попытка ${attempt})`, error, 'LLMProvider');
          throw error;
        }

        if (attempt < maxRetries) {
          const delay = this.calculateRetryDelay(attempt);
          logger.warn(`Ошибка LLM (попытка ${attempt}/${maxRetries}), повтор через ${delay}мс`, 'LLMProvider');
          await this.sleep(delay);
        } else {
          logger.error(`Все попытки исчерпаны (${maxRetries})`, error, 'LLMProvider');
        }
      }
    }

    // После всех попыток проверяем тип последней ошибки
    if (lastError instanceof NetworkError) {
      // Если это NetworkError (проблемы с сетью), выбрасываем его, а не оборачиваем в LLMError
      throw lastError;
    }
    
    throw new LLMError(
      'Failed after ' + maxRetries + ' attempts: ' + (lastError?.message || 'Unknown error'),
      false,
      'Не удалось получить ответ от LLM. Проверьте настройки и попробуйте позже.'
    );
  }

  /**
   * Генерирует ответ от LLM в режиме streaming (поток токенов).
   */
  async *generateStream(prompt: string, options: GenerateOptions = {}): AsyncIterable<string> {
    const timeout = options.timeout || 60000;

    logger.info(`Отправка streaming-запроса к LLM (модель: ${this.currentModel})`, 'LLMProvider');

    try {
      logger.info('Отправка запроса на URL: ' + this.currentBaseUrl + '/chat/completions', 'LLMProvider');
      logger.info('Модель: ' + this.currentModel, 'LLMProvider');
      const response = await this.axiosInstance.post(
        `${this.currentBaseUrl}/chat/completions`,
        {
          model: this.currentModel,
          messages: [
            { role: 'system', content: options.systemPrompt || this.configManager.getDefaultSystemPrompt() },
            { role: 'user', content: prompt }
          ],
          temperature: options.temperature || 0.7,
          max_tokens: options.maxTokens || 2000,
          stream: true
        },
        {
          headers: {
            Authorization: `Bearer ${this.currentApiKey}`
          },
          timeout,
          responseType: 'stream'
        }
      );

      // Обрабатываем поток данных
      for await (const chunk of response.data) {
        const lines = chunk.toString().split('\n').filter((line: string) => line.trim() !== '');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              return;
            }
            
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                yield content;
              }
            } catch (error) {
              logger.warn('Не удалось распарсить chunk: ' + (error instanceof Error ? error.message : String(error)), 'LLMProvider');
            }
          }
        }
      }
    } catch (error) {
      logger.error('Ошибка streaming-запроса', error, 'LLMProvider');
      throw this.wrapError(error);
    }
  }

  setModel(model: string): void {
    this.currentModel = model;
    logger.info(`Модель изменена: ${model}`, 'LLMProvider');
  }

  setBaseUrl(url: string): void {
    this.currentBaseUrl = this.normalizeUrl(url);
    logger.info(`Base URL изменён: ${url}`, 'LLMProvider');
  }

  setApiKey(key: string): void {
    this.currentApiKey = key;
    logger.info('API ключ изменён', 'LLMProvider');
  }

  getModel(): string {
    return this.currentModel;
  }

  getBaseUrl(): string {
    return this.currentBaseUrl;
  }

  /**
   * Отправляет запрос к LLM API.
   */
  private async sendRequest(
    prompt: string,
    options: GenerateOptions,
    timeout: number
  ): Promise<LLMResponse> {
    try {
      const response = await this.axiosInstance.post(
        `${this.currentBaseUrl}/chat/completions`,
        {
          model: this.currentModel,
          messages: [
            { role: 'system', content: options.systemPrompt || this.configManager.getDefaultSystemPrompt() },
            { role: 'user', content: prompt }
          ],
          temperature: options.temperature || 0.7,
          max_tokens: options.maxTokens || 2000,
          top_p: options.topP || 1.0,
          frequency_penalty: options.frequencyPenalty || 0.0,
          presence_penalty: options.presencePenalty || 0.0,
          stream: false
        },
        {
          headers: {
            Authorization: `Bearer ${this.currentApiKey}`
          },
          timeout
        }
      );

      const data = response.data;
      if (!data.choices || data.choices.length === 0) {
        throw new LLMError('No choices in response', false, 'LLM не вернул ответ.');
      }
      
      const choice = data.choices[0];
      
      if (!choice.message || typeof choice.message.content !== 'string') {
        throw new LLMError('Invalid choice format', false, 'LLM вернул некорректный ответ.');
      }

      if (!choice) {
        throw new LLMError('No choices in response', false, 'LLM не вернул ответ.');
      }

      return {
        content: choice.message?.content || '',
        model: data.model || this.currentModel,
        tokensUsed: data.usage?.total_tokens || 0,
        finishReason: choice.finish_reason || 'unknown',
        metadata: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0
        }
      };
    } catch (error) {
      throw this.wrapError(error);
    }
  }

  /**
   * Оборачивает ошибку axios в LLMError или NetworkError.
   */
  private wrapError(error: unknown): LLMError | NetworkError {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      
      if (axiosError.response) {
        // Сервер вернул ошибку (4xx, 5xx)
        const status = axiosError.response.status;
        const message = `API error: ${status} - ${JSON.stringify(axiosError.response.data)}`;
        
        if (status === 429) {
          return new LLMError(message, true, 'Превышен лимит запросов. Подождите и попробуйте снова.');
        }
        
        if (status >= 500) {
          return new NetworkError(message, status, 'Сервер LLM временно недоступен. Попробуйте позже.');
        }
        
        return new LLMError(message, false, `Ошибка API: ${status}`);
      }
      
      if (axiosError.code === 'ECONNABORTED') {
        return new NetworkError('Request timeout', undefined, 'Превышено время ожидания ответа от LLM.');
      }
      
      return new NetworkError(
        axiosError.message,
        undefined,
        'Ошибка соединения. Проверьте интернет и настройки.'
      );
    }
    
    return new LLMError(
      error instanceof Error ? error.message : String(error),
      false,
      'Неизвестная ошибка при обращении к LLM.'
    );
  }

  /**
   * Вычисляет задержку для повторной попытки (экспоненциальная backoff).
   */
  private calculateRetryDelay(attempt: number): number {
    const baseDelay = 1000; // 1 секунда
    const maxDelay = 30000; // 30 секунд
    const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
    return delay;
  }

  /**
   * Утилитарная функция для задержки.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Нормализует URL: убирает trailing slash, чтобы избежать двойных слешей.
   * Пример: 'https://api.proxyapi.ru/openai/v1/' → 'https://api.proxyapi.ru/openai/v1'
   */
  private normalizeUrl(url: string): string {
    return url.replace(/\/+$/, '');
  }
}
