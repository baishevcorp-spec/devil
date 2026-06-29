/**
 * Интерфейс MultiModelManager (BCK-23)
 * 
 * Управляет несколькими конфигурациями LLM-моделей,
 * позволяет переключаться между моделями и выбирать
 * подходящую модель для разных типов задач.
 */

/**
 * Типы задач, для которых можно назначить разные модели.
 */
export type TaskType = 'chat' | 'refactor' | 'generate' | 'explain';

/**
 * Конфигурация одной LLM-модели.
 */
export interface ModelConfig {
  /** Уникальный идентификатор модели (например, 'fast', 'powerful', 'local') */
  id: string;
  
  /** Отображаемое имя модели */
  name: string;
  
  /** Base URL API (OpenAI-совместимый) */
  baseUrl: string;
  
  /** API-ключ (может быть зашифрован через keytar) */
  apiKey: string;
  
  /** Имя модели в API (например, 'gpt-4o-mini', 'gpt-4o', 'llama3.1') */
  model: string;
  
  /** Типы задач, для которых эта модель подходит */
  taskTypes: TaskType[];
  
  /** Максимальное количество повторных попыток при ошибках */
  maxRetries?: number;
  
  /** Температура генерации (0.0 - 2.0) */
  temperature?: number;
  
  /** Максимальное количество токенов в ответе */
  maxTokens?: number;
  
  /** Является ли модель активной по умолчанию */
  isDefault?: boolean;
}

/**
 * Интерфейс менеджера моделей.
 */
export interface IMultiModelManager {
  /**
   * Получить список всех доступных моделей.
   */
  getAvailableModels(): ModelConfig[];
  
  /**
   * Переключиться на указанную модель.
   * @param modelId ID модели для переключения
   * @throws Error если модель не найдена
   */
  switchModel(modelId: string): void;
  
  /**
   * Получить ID модели, подходящей для указанного типа задачи.
   * Если модель для задачи не найдена, возвращает ID активной модели.
   * @param task Тип задачи
   */
  getModelForTask(task: TaskType): string;
  
  /**
   * Добавить новую модель в конфигурацию.
   * @param config Конфигурация модели
   * @throws Error если модель с таким id уже существует
   */
  addModel(config: ModelConfig): void;
  
  /**
   * Удалить модель из конфигурации.
   * @param modelId ID модели для удаления
   * @throws Error если модель не найдена или является единственной
   */
  removeModel(modelId: string): void;
  
  /**
   * Получить текущую активную модель.
   * @returns Конфигурация активной модели или null, если моделей нет
   */
  getCurrentModel(): ModelConfig | null;
  
  /**
   * Получить ID текущей активной модели.
   */
  getCurrentModelId(): string | null;
  
  /**
   * Обновить конфигурацию существующей модели.
   * @param modelId ID модели
   * @param updates Поля для обновления
   */
  updateModel(modelId: string, updates: Partial<ModelConfig>): void;
  
  /**
   * Освободить ресурсы (подписки, таймеры).
   */
  dispose(): void;
}
