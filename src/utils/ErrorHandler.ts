export enum ErrorType {
  NETWORK = 'NETWORK',
  LLM = 'LLM',
  FILE_SYSTEM = 'FILE_SYSTEM',
  CONFIG = 'CONFIG',
  PROJECT = 'PROJECT',
  DATABASE = 'DATABASE',
  UNKNOWN = 'UNKNOWN'
}

export interface DevilError {
  type: ErrorType;
  message: string;
  userMessage: string;
  details?: unknown;
  timestamp: number;
}

/**
 * ErrorHandler — централизованная обработка ошибок.
 * Классифицирует ошибки и возвращает user-friendly сообщения на русском.
 */
export class ErrorHandler {
  private static instance: ErrorHandler;

  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  classifyError(error: any): DevilError {
    const timestamp = Date.now();
    const message = error?.message || 'Unknown error';

    // Network errors
    if (error?.code === 'ECONNREFUSED' || error?.code === 'ETIMEDOUT' || error?.code === 'ENOTFOUND') {
      return {
        type: ErrorType.NETWORK,
        message,
        userMessage: 'Не удалось подключиться к серверу. Проверьте интернет-соединение и настройки прокси.',
        details: { code: error.code },
        timestamp
      };
    }

    // LLM errors
    if (error?.response?.status === 429) {
      return {
        type: ErrorType.LLM,
        message: 'Rate limit exceeded',
        userMessage: 'Превышен лимит запросов к LLM. Подождите немного и попробуйте снова.',
        details: { status: 429 },
        timestamp
      };
    }

    if (error?.response?.status === 401 || error?.response?.status === 403) {
      return {
        type: ErrorType.LLM,
        message: 'Authentication failed',
        userMessage: 'Ошибка аутентификации. Проверьте API-ключ в настройках (devil.apiKey).',
        details: { status: error.response.status },
        timestamp
      };
    }

    if (error?.response?.status >= 500) {
      return {
        type: ErrorType.LLM,
        message: 'Server error',
        userMessage: 'Сервер LLM временно недоступен. Повторная попытка будет выполнена автоматически.',
        details: { status: error.response.status },
        timestamp
      };
    }

    // File system errors
    if (error?.code === 'ENOENT') {
      return {
        type: ErrorType.FILE_SYSTEM,
        message: `File not found: ${error.path}`,
        userMessage: `Файл не найден: ${error.path}`,
        details: { path: error.path },
        timestamp
      };
    }

    if (error?.code === 'EACCES') {
      return {
        type: ErrorType.FILE_SYSTEM,
        message: `Permission denied: ${error.path}`,
        userMessage: `Нет доступа к файлу: ${error.path}`,
        details: { path: error.path },
        timestamp
      };
    }

    // Config errors
    if (message.includes('apiKey') || message.includes('baseUrl')) {
      return {
        type: ErrorType.CONFIG,
        message,
        userMessage: 'Ошибка конфигурации. Проверьте настройки расширения (devil.baseUrl, devil.apiKey).',
        details: { field: message },
        timestamp
      };
    }

    // Project errors
    if (message.includes('project') || message.includes('workspace')) {
      return {
        type: ErrorType.PROJECT,
        message,
        userMessage: 'Проект не открыт. Используйте команду "Devil: Open Project".',
        details: {},
        timestamp
      };
    }

    // Database errors
    if (message.includes('database') || message.includes('sqlite')) {
      return {
        type: ErrorType.DATABASE,
        message,
        userMessage: 'Ошибка базы данных. Попробуйте перезапустить расширение.',
        details: {},
        timestamp
      };
    }

    // Unknown errors
    return {
      type: ErrorType.UNKNOWN,
      message,
      userMessage: 'Произошла неизвестная ошибка. Проверьте Output Channel "Devil" для деталей.',
      details: { error: message, stack: error?.stack },
      timestamp
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getUserFriendlyMessage(error: any): string {
    const devilError = this.classifyError(error);
    return devilError.userMessage;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shouldRetry(error: any): boolean {
    const devilError = this.classifyError(error);
    return devilError.type === ErrorType.NETWORK || 
           (devilError.type === ErrorType.LLM && typeof devilError.details === 'object' && devilError.details !== null && (devilError.details as { status?: number }).status !== undefined && (devilError.details as { status: number }).status >= 500);
  }
}
