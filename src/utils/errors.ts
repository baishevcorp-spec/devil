/**
 * Базовый класс ошибок расширения Devil.
 * Все кастомные ошибки наследуются от него.
 */
export class DevilError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly userMessage?: string
  ) {
    super(message);
    this.name = 'DevilError';
    // Восстанавливаем цепочку прототипов (важно для instanceof)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Ошибка конфигурации (неверный API-ключ, baseUrl и т.д.).
 */
export class ConfigError extends DevilError {
  constructor(message: string, userMessage?: string) {
    super(message, 'CONFIG_ERROR', userMessage || 'Ошибка конфигурации. Проверьте настройки расширения.');
    this.name = 'ConfigError';
  }
}

/**
 * Ошибка сети (таймаут, недоступность API, 5xx).
 */
export class NetworkError extends DevilError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    userMessage?: string
  ) {
    super(message, 'NETWORK_ERROR', userMessage || 'Ошибка соединения. Проверьте интернет и настройки прокси.');
    this.name = 'NetworkError';
  }
}

/**
 * Ошибка LLM API (невалидный ответ, content filter, rate limit).
 */
export class LLMError extends DevilError {
  constructor(
    message: string,
    public readonly retryable: boolean = false,
    userMessage?: string
  ) {
    super(message, 'LLM_ERROR', userMessage || 'Ошибка при обращении к LLM.');
    this.name = 'LLMError';
  }
}

/**
 * Ошибка при работе с файловой системой или проектом.
 */
export class ProjectError extends DevilError {
  constructor(message: string, userMessage?: string) {
    super(message, 'PROJECT_ERROR', userMessage || 'Ошибка при работе с проектом.');
    this.name = 'ProjectError';
  }
}

/**
 * Преобразует любую ошибку в понятное пользователю сообщение.
 */
export function getUserFriendlyMessage(error: unknown): string {
  if (error instanceof DevilError && error.userMessage) {
    return error.userMessage;
  }
  if (error instanceof Error) {
    return `Произошла ошибка: ${error.message}`;
  }
  return 'Произошла неизвестная ошибка.';
}
