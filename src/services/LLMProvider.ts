import axios, { AxiosInstance, AxiosError } from 'axios';
import { ConfigManager } from './ConfigManager';
import { LLMError, NetworkError } from '../utils/errors';
import { logger } from '../utils/logger';
import { ModelConfig } from '../interfaces/IMultiModelManager';
import { ILLMProvider, GenerateOptions, LLMResponse } from '../interfaces/ILLMProvider';

/**
 * Проверяет, является ли модель современной (gpt-5.x, o1, o3, o4),
 * которая требует max_completion_tokens вместо max_tokens.
 */
function isModernModel(model: string): boolean {
  if (!model) return false;
  const lowerModel = model.toLowerCase();
  return (
    lowerModel.startsWith('gpt-5') ||
    lowerModel.startsWith('o1') ||
    lowerModel.startsWith('o3') ||
    lowerModel.startsWith('o4') ||
    lowerModel.startsWith('gpt-4.1')
  );
}

/**
 * Проверяет, поддерживает ли модель параметр temperature.
 * Рассуждающие модели (o1, o3, o4) и gpt-5.x не поддерживают temperature.
 */
function supportsTemperature(model: string): boolean {
  if (!model) return true;
  const lowerModel = model.toLowerCase();
  return !(
    lowerModel.startsWith('o1') ||
    lowerModel.startsWith('o3') ||
    lowerModel.startsWith('o4') ||
    lowerModel.startsWith('gpt-5')
  );
}

/**
 * Формирует параметр для ограничения токенов в зависимости от модели.
 */
function buildMaxTokensParam(
  model: string,
  endpointType: 'chat' | 'completion' | 'responses',
  maxTokens: number
): Record<string, number> {
  // Для Responses API используем max_output_tokens
  if (endpointType === 'responses') {
    return { max_output_tokens: maxTokens };
  }

  // Для современных моделей (gpt-5.x, o1, o3, o4) в chat/completions
  if (isModernModel(model)) {
    return { max_completion_tokens: maxTokens };
  }

  // Для старых моделей
  return { max_tokens: maxTokens };
}

/**
 * Определяет тип API endpoint для модели.
 */
function getModelEndpointType(model: string): 'chat' | 'completion' | 'responses' {
  if (!model) return 'chat';
  const lowerModel = model.toLowerCase();

  if (lowerModel.includes('gpt-5.5-pro')) {
    return 'completion';
  }

  if (
    lowerModel.startsWith('gpt-5') ||
    lowerModel.startsWith('o1') ||
    lowerModel.startsWith('o3') ||
    lowerModel.startsWith('o4')
  ) {
    return 'responses';
  }

  return 'chat';
}

/**
 * Формирует путь endpoint'а без дублирования /v1/.
 */
function getEndpointPath(endpointType: 'chat' | 'completion' | 'responses'): string {
  switch (endpointType) {
    case 'chat':
      return '/chat/completions';
    case 'completion':
      return '/completions';
    case 'responses':
      return '/responses';
  }
}

/**
 * Формирует request body в зависимости от endpoint'а.
 */
function buildRequestBody(
  model: string,
  endpointType: 'chat' | 'completion' | 'responses',
  prompt: string,
  options: GenerateOptions
): Record<string, unknown> {
  const systemPrompt = options.systemPrompt || '';
  // ✅ Передаём endpointType в buildMaxTokensParam
  const maxTokensParam = buildMaxTokensParam(model, endpointType, options.maxTokens || 2000);

  switch (endpointType) {
    case 'completion': {
      return {
        model,
        prompt,
        ...(supportsTemperature(model) ? { temperature: options.temperature || 0.7 } : {}),
        ...maxTokensParam,
        stream: options.stream,
      };
    }

    case 'responses': {
      return {
        model,
        instructions: systemPrompt,
        input: [
          { role: 'user', content: prompt },
        ],
        ...maxTokensParam, // ✅ Теперь это max_output_tokens
        stream: options.stream,
      };
    }

    case 'chat': {
      return {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        ...(supportsTemperature(model) ? { temperature: options.temperature || 0.7 } : {}),
        ...maxTokensParam,
        top_p: options.topP ?? 1.0,
        frequency_penalty: options.frequencyPenalty ?? 0.0,
        presence_penalty: options.presencePenalty ?? 0.0,
        stream: options.stream,
      };
    }
  }
}

/**
 * Извлекает содержимое ответа из data в зависимости от endpoint'а.
 */
function extractContentFromResponse(
  data: Record<string, unknown>,
  endpointType: 'chat' | 'completion' | 'responses'
): string {
  switch (endpointType) {
    case 'completion': {
      const choices = data.choices as Array<{ text?: string }> | undefined;
      return choices?.[0]?.text || '';
    }

    case 'responses': {
      const output = data.output as Array<{
        type?: string;
        content?: Array<{ type?: string; text?: string }>;
      }> | undefined;
      const firstOutput = output?.[0];
      const textBlock = firstOutput?.content?.[0];
      return textBlock?.type === 'output_text' ? textBlock.text || '' : '';
    }

    case 'chat': {
      const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
      return choices?.[0]?.message?.content || '';
    }
  }
}

/**
 * Извлекает количество использованных токенов.
 */
function extractTokensUsed(
  data: Record<string, unknown>,
  endpointType: 'chat' | 'completion' | 'responses'
): number {
  const usage = data.usage as Record<string, number> | undefined;
  if (!usage) return 0;

  if (endpointType === 'responses') {
    return usage.total_tokens ?? 0;
  }
  return usage.total_tokens ?? 0;
}

/**
 * Извлекает причину завершения генерации.
 */
function extractFinishReason(
  data: Record<string, unknown>,
  endpointType: 'chat' | 'completion' | 'responses'
): string {
  if (endpointType === 'responses') {
    return (data.status as string) ?? 'unknown';
  }
  const choices = data.choices as Array<{ finish_reason?: string }> | undefined;
  return choices?.[0]?.finish_reason ?? 'unknown';
}

/**
 * Проверяет валидность ответа от API.
 */
function validateResponseData(
  data: Record<string, unknown>,
  endpointType: 'chat' | 'completion' | 'responses'
): void {
  if (endpointType === 'responses') {
    const output = data.output as unknown[] | undefined;
    if (!output || output.length === 0) {
      throw new LLMError(
        'No output in response',
        false,
        'LLM не вернул ответ. Проверьте промпт или настройки модели.'
      );
    }
  } else {
    const choices = data.choices as unknown[] | undefined;
    if (!choices || choices.length === 0) {
      throw new LLMError(
        'No choices in response',
        false,
        'LLM не вернул ответ. Проверьте промпт или настройки модели.'
      );
    }
  }
}

/**
 * LLMProvider — HTTP-клиент для работы с OpenAI-совместимым API.
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
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    configManager.onConfigChanged(() => {
      this.currentModel = configManager.getModel();
      this.currentBaseUrl = this.normalizeUrl(configManager.getBaseUrl());
      this.currentApiKey = configManager.getApiKey();
      logger.info('Конфигурация LLM обновлена', 'LLMProvider');
    });

    logger.info('LLMProvider инициализирован', 'LLMProvider');
  }

  async generate(prompt: string, options: GenerateOptions = {}): Promise<LLMResponse> {
    const maxRetries = options.maxRetries ?? this.configManager.getMaxRetries();
    const timeout = options.timeout ?? 60000;

    logger.info(`Отправка запроса к LLM (модель: ${this.currentModel})`, 'LLMProvider');
    logger.debug(`Промпт: ${prompt.substring(0, 100)}...`, 'LLMProvider');

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.sendRequest(prompt, options, timeout);
        logger.info(
          `Ответ получен (попытка ${attempt}, токенов: ${response.tokensUsed})`,
          'LLMProvider'
        );
        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof LLMError && !error.retryable) {
          logger.error(`Неразрешимая ошибка LLM (попытка ${attempt})`, error, 'LLMProvider');
          throw error;
        }

        if (attempt < maxRetries) {
          const delay = this.calculateRetryDelay(attempt);
          logger.warn(
            `Ошибка LLM (попытка ${attempt}/${maxRetries}), повтор через ${delay}мс`,
            'LLMProvider'
          );
          await this.sleep(delay);
        } else {
          logger.error(`Все попытки исчерпаны (${maxRetries})`, error, 'LLMProvider');
        }
      }
    }

    if (lastError instanceof NetworkError) {
      throw lastError;
    }

    throw new LLMError(
      `Failed after ${maxRetries} attempts: ${lastError?.message ?? 'Unknown error'}`,
      false,
      'Не удалось получить ответ от LLM. Проверьте настройки и попробуйте позже.'
    );
  }

  async *generateStream(prompt: string, options: GenerateOptions = {}): AsyncIterable<string> {
    const timeout = options.timeout ?? 60000;
    const endpointType = getModelEndpointType(this.currentModel);
    const endpointPath = getEndpointPath(endpointType);

    logger.info(`Отправка streaming-запроса к LLM (модель: ${this.currentModel})`, 'LLMProvider');

    try {
      const requestBody = buildRequestBody(this.currentModel, endpointType, prompt, {
        ...options,
        stream: true,
      });

      // ✅ Убрано дублирование /v1/
      const url = `${this.currentBaseUrl}${endpointPath}`;
      logger.info(`Отправка запроса на URL: ${url}`, 'LLMProvider');
      logger.debug(`Модель: ${this.currentModel}`, 'LLMProvider');

      const response = await this.axiosInstance.post(
        url,
        requestBody,
        {
          headers: {
            Authorization: `Bearer ${this.currentApiKey}`,
            'Content-Type': 'application/json',
          },
          timeout,
          responseType: 'stream',
        }
      );

      for await (const chunk of response.data) {
        const lines = chunk
          .toString()
          .split('\n')
          .filter((line: string) => line.trim() !== '');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            if (dataStr === '[DONE]') {
              return;
            }

            try {
              const parsed = JSON.parse(dataStr);
              let content: string | undefined;

              if (endpointType === 'responses') {
                if (parsed.type === 'response.output_text.delta') {
                  content = parsed.delta;
                }
              } else if (endpointType === 'chat') {
                content = parsed.choices?.[0]?.delta?.content;
              } else if (endpointType === 'completion') {
                content = parsed.choices?.[0]?.text;
              }

              if (content !== undefined && content !== '') {
                yield content;
              }
            } catch (error) {
              logger.warn(
                `Ошибка парсинга chunk: ${error instanceof Error ? error.message : String(error)}`,
                'LLMProvider'
              );
            }
          }
        }
      }
    } catch (error) {
      logger.error('Ошибка streaming-запроса', error, 'LLMProvider');
      throw this.wrapError(error);
    }
  }

  private async sendRequest(
    prompt: string,
    options: GenerateOptions,
    timeout: number
  ): Promise<LLMResponse> {
    try {
      const endpointType = getModelEndpointType(this.currentModel);
      const endpointPath = getEndpointPath(endpointType);
      const requestBody = buildRequestBody(this.currentModel, endpointType, prompt, {
        ...options,
        stream: false,
      });

      // ✅ Убрано дублирование /v1/
      const url = `${this.currentBaseUrl}${endpointPath}`;
      logger.info(`Отправка запроса на URL: ${url}`, 'LLMProvider');
      logger.debug(
        `Модель: ${this.currentModel}, maxTokens: ${options.maxTokens ?? 2000}`,
        'LLMProvider'
      );

      const response = await this.axiosInstance.post(
        url,
        requestBody,
        {
          headers: {
            Authorization: `Bearer ${this.currentApiKey}`,
            'Content-Type': 'application/json',
          },
          timeout,
        }
      );

      const data = response.data as Record<string, unknown>;

      // ✅ Проверка валидности ответа (учитывает responses endpoint)
      validateResponseData(data, endpointType);

      const content = extractContentFromResponse(data, endpointType);
      const model = (data.model as string) ?? this.currentModel;
      const tokensUsed = extractTokensUsed(data, endpointType);
      const finishReason = extractFinishReason(data, endpointType);

      const usage = data.usage as Record<string, number> | undefined;

      return {
        content,
        model,
        tokensUsed,
        finishReason,
        metadata: {
          promptTokens: usage?.prompt_tokens ?? 0,
          completionTokens: usage?.completion_tokens ?? 0,
        },
      };
    } catch (error) {
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

  applyModelConfig(config: ModelConfig): void {
    this.setBaseUrl(config.baseUrl);
    this.setApiKey(config.apiKey);
    this.setModel(config.model);
    logger.info(`Применена конфигурация модели: ${config.name} (${config.model})`, 'LLMProvider');
  }

  private wrapError(error: unknown): LLMError | NetworkError {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;

      if (axiosError.response) {
        const status = axiosError.response.status;
        const message = `API error: ${status} - ${JSON.stringify(axiosError.response.data)}`;

        if (status === 429) {
          return new LLMError(
            message,
            true,
            'Превышен лимит запросов. Подождите и попробуйте снова.'
          );
        }

        if (status >= 500) {
          return new NetworkError(
            message,
            status,
            'Сервер LLM временно недоступен. Попробуйте позже.'
          );
        }

        if (status === 401 || status === 403) {
          return new LLMError(message, false, 'Ошибка авторизации. Проверьте API ключ.');
        }

        return new LLMError(message, false, `Ошибка API: ${status}`);
      }

      if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT') {
        return new NetworkError(
          `Request timeout: ${axiosError.message}`,
          undefined,
          'Сервер не ответил вовремя.'
        );
      }

      if (axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ENOTFOUND') {
        return new NetworkError(
          `Network error: ${axiosError.message}`,
          undefined,
          'Не удалось подключиться к серверу LLM.'
        );
      }

      return new LLMError(
        `Request failed: ${axiosError.message}`,
        false,
        'Не удалось выполнить запрос к LLM.'
      );
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    return new LLMError(`Unexpected error: ${errorMessage}`, false, 'Внутренняя ошибка системы.');
  }

  private normalizeUrl(url: string): string {
    return url.replace(/\/+$/, '');
  }

  private calculateRetryDelay(attempt: number): number {
    return Math.min(1000 * 2 ** (attempt - 1), 30000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
