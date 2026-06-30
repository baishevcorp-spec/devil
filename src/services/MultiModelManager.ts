import { IMultiModelManager, ModelConfig, TaskType } from '../interfaces/IMultiModelManager';
import { ConfigManager } from './ConfigManager';
import { logger } from '../utils/logger';

/**
 * MultiModelManager — менеджер LLM-моделей (BCK-23).
 *
 * Управляет несколькими конфигурациями моделей, позволяет переключаться
 * между ними и автоматически выбирает подходящую модель для разных типов задач.
 *
 * Пример использования:
 * ```typescript
 * const manager = new MultiModelManager(configManager);
 *
 * // Получить все модели
 * const models = manager.getAvailableModels();
 *
 * // Переключиться на конкретную модель
 * manager.switchModel('powerful');
 *
 * // Автоматически выбрать модель для задачи
 * const modelId = manager.getModelForTask('refactor');
 * ```
 */
export class MultiModelManager implements IMultiModelManager {
  private models: ModelConfig[] = [];
  private currentModelId: string | null = null;

constructor(private readonly configManager: ConfigManager) {
  const models = configManager.getModels();
  if (models.length > 0) {
    this.models = [...models];  // ✅ Создаём копию массива
    const defaultModel = models.find(m => m.isDefault) || models[0];
    this.currentModelId = defaultModel.id;
  } else {
    this.models = [...configManager.getDefaultModels()];  // ✅ Создаём копию массива
    const defaultModel = this.models.find(m => m.isDefault) || this.models[0];
    if (defaultModel) {
      this.currentModelId = defaultModel.id;
    }
  }
  logger.info(`MultiModelManager инициализирован с ${this.models.length} моделями`, 'MultiModelManager');
}

  /**
   * Загружает модели из конфигурации ConfigManager.
   */
  private loadModelsFromConfig(): void {
    try {
      const configModels = this.configManager.getModels();
      if (configModels && configModels.length > 0) {
        this.models = [...configModels]; // Копия массива, чтобы не мутировать исходные данные

        // Устанавливаем активную модель: либо isDefault=true, либо первую
        const defaultModel = this.models.find(m => m.isDefault);
        this.currentModelId = defaultModel ? defaultModel.id : this.models[0].id;

        logger.info('Загружено моделей из конфига: ' + this.models.length, 'MultiModelManager');
      } else {
        // Если моделей нет в конфиге — создаём дефолтную из текущих настроек
        const fallbackModel: ModelConfig = {
          id: 'default',
          name: 'Default Model',
          baseUrl: this.configManager.getBaseUrl(),
          apiKey: this.configManager.getApiKey(),
          model: this.configManager.getModel(),
          taskTypes: ['chat', 'refactor', 'generate', 'explain'],
          isDefault: true
        };
        this.models = [fallbackModel];
        this.currentModelId = 'default';
        logger.info('Использована дефолтная модель из ConfigManager', 'MultiModelManager');
      }
    } catch (error) {
      logger.error('Ошибка загрузки моделей из конфига', error, 'MultiModelManager');
      this.models = [];
      this.currentModelId = null;
    }
  }

  getAvailableModels(): ModelConfig[] {
    return [...this.models];
  }

  switchModel(modelId: string): void {
    const model = this.models.find(m => m.id === modelId);
    if (!model) {
      throw new Error('Модель не найдена: ' + modelId);
    }
    this.currentModelId = modelId;
    logger.info('Переключение на модель: ' + model.name + ' (' + model.model + ')', 'MultiModelManager');
  }

  getModelForTask(task: TaskType): string {
    // Ищем модель, которая поддерживает этот тип задачи
    const suitableModel = this.models.find(m => m.taskTypes.includes(task));

    if (suitableModel) {
      return suitableModel.id;
    }

    // Если не нашли — возвращаем текущую активную модель
    if (this.currentModelId) {
      return this.currentModelId;
    }

    // Если и активной нет — возвращаем первую доступную
    if (this.models.length > 0) {
      return this.models[0].id;
    }

    throw new Error('Нет доступных моделей');
  }

  addModel(config: ModelConfig): void {
    if (this.models.some(m => m.id === config.id)) {
      throw new Error('Модель с id "' + config.id + '" уже существует');
    }
    this.models.push(config);
    logger.info('Добавлена модель: ' + config.name + ' (' + config.id + ')', 'MultiModelManager');

    // Если это первая модель — делаем её активной
    if (this.models.length === 1) {
      this.currentModelId = config.id;
    }
  }

  removeModel(modelId: string): void {
    const index = this.models.findIndex(m => m.id === modelId);
    if (index === -1) {
      throw new Error('Модель не найдена: ' + modelId);
    }
    if (this.models.length === 1) {
      throw new Error('Нельзя удалить единственную модель');
    }

    this.models.splice(index, 1);
    logger.info('Удалена модель: ' + modelId, 'MultiModelManager');

    // Если удалили активную модель — переключаемся на первую
    if (this.currentModelId === modelId) {
      this.currentModelId = this.models[0].id;
      logger.info('Активная модель переключена на: ' + this.currentModelId, 'MultiModelManager');
    }
  }

  getCurrentModel(): ModelConfig | null {
    if (!this.currentModelId) return null;
    return this.models.find(m => m.id === this.currentModelId) || null;
  }

  getCurrentModelId(): string | null {
    return this.currentModelId;
  }

  updateModel(modelId: string, updates: Partial<ModelConfig>): void {
    const index = this.models.findIndex(m => m.id === modelId);
    if (index === -1) {
      throw new Error('Модель не найдена: ' + modelId);
    }

    // Нельзя менять id через update
    const { id, ...rest } = updates;
    void id; // Игнорируем id, чтобы не менять его через update
    this.models[index] = { ...this.models[index], ...rest };
    logger.info('Обновлена модель: ' + modelId, 'MultiModelManager');
  }

  dispose(): void {
    this.models = [];
    this.currentModelId = null;
    logger.info('MultiModelManager остановлен', 'MultiModelManager');
  }
}
