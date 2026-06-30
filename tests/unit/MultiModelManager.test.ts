import { MultiModelManager } from '../../src/services/MultiModelManager';
import { ConfigManager } from '../../src/services/ConfigManager';
import { ModelConfig } from '../../src/interfaces/IMultiModelManager';

describe('MultiModelManager', () => {
  let manager: MultiModelManager;
  let mockConfigManager: jest.Mocked<ConfigManager>;

  const mockModels: ModelConfig[] = [
    {
      id: 'fast',
      name: 'GPT-4o Mini',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-fast',
      model: 'gpt-4o-mini',
      taskTypes: ['chat', 'explain'],
      isDefault: true
    },
    {
      id: 'powerful',
      name: 'GPT-4o',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-powerful',
      model: 'gpt-4o',
      taskTypes: ['refactor', 'generate']
    },
    {
      id: 'local',
      name: 'Ollama',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'ollama',
      model: 'llama3.1',
      taskTypes: ['chat']
    }
  ];

  const fallbackModels: ModelConfig[] = [
    {
      id: 'fallback',
      name: 'Fallback Model',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-fallback',
      model: 'fallback-model',
      taskTypes: ['chat'],
      isDefault: true
    }
  ];

  beforeEach(() => {
    mockConfigManager = {
      getModels: jest.fn().mockReturnValue(mockModels),
      getDefaultModels: jest.fn().mockReturnValue(fallbackModels),
      getBaseUrl: jest.fn().mockReturnValue('https://api.example.com/v1'),
      getApiKey: jest.fn().mockReturnValue('sk-default'),
      getModel: jest.fn().mockReturnValue('gpt-4o-mini')
    } as unknown as jest.Mocked<ConfigManager>;

    manager = new MultiModelManager(mockConfigManager);
  });

  describe('getAvailableModels', () => {
    it('возвращает все модели из конфига', () => {
      const models = manager.getAvailableModels();
      expect(models).toHaveLength(3);
      expect(models.map(m => m.id)).toEqual(['fast', 'powerful', 'local']);
    });

    it('возвращает копию массива (не оригинал)', () => {
      const models1 = manager.getAvailableModels();
      const models2 = manager.getAvailableModels();
      expect(models1).not.toBe(models2);
    });
  });

  describe('getCurrentModel', () => {
    it('возвращает модель с isDefault=true как активную', () => {
      const current = manager.getCurrentModel();
      expect(current).not.toBeNull();
      expect(current!.id).toBe('fast');
      expect(current!.isDefault).toBe(true);
    });

    it('возвращает fallback модель, если моделей нет в конфиге', () => {
      mockConfigManager.getModels.mockReturnValue([]);
      mockConfigManager.getDefaultModels.mockReturnValue(fallbackModels);
      const emptyManager = new MultiModelManager(mockConfigManager);
      const current = emptyManager.getCurrentModel();
      expect(current).not.toBeNull();
      expect(current!.id).toBe('fallback');
    });
  });

  describe('switchModel', () => {
    it('переключает активную модель', () => {
      manager.switchModel('powerful');
      expect(manager.getCurrentModelId()).toBe('powerful');
    });

    it('бросает ошибку для несуществующей модели', () => {
      expect(() => manager.switchModel('nonexistent')).toThrow('Модель не найдена');
    });
  });

  describe('getModelForTask', () => {
    it('возвращает модель, подходящую для задачи chat', () => {
      const modelId = manager.getModelForTask('chat');
      expect(['fast', 'local']).toContain(modelId);
    });

    it('возвращает модель для задачи refactor', () => {
      const modelId = manager.getModelForTask('refactor');
      expect(modelId).toBe('powerful');
    });

    it('возвращает модель для задачи generate', () => {
      const modelId = manager.getModelForTask('generate');
      expect(modelId).toBe('powerful');
    });

    it('возвращает модель для задачи explain', () => {
      const modelId = manager.getModelForTask('explain');
      expect(modelId).toBe('fast');
    });

    it('возвращает текущую модель, если нет подходящей', () => {
      mockConfigManager.getModels.mockReturnValue([
        {
          id: 'only-chat',
          name: 'Only Chat',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'sk-test',
          model: 'test-model',
          taskTypes: ['chat']
        }
      ]);
      const testManager = new MultiModelManager(mockConfigManager);
      const modelId = testManager.getModelForTask('refactor');
      expect(modelId).toBe('only-chat');
    });
  });

  describe('addModel', () => {
    it('добавляет новую модель', () => {
      const newModel: ModelConfig = {
        id: 'new',
        name: 'New Model',
        baseUrl: 'https://api.new.com/v1',
        apiKey: 'sk-new',
        model: 'new-model',
        taskTypes: ['chat']
      };
      manager.addModel(newModel);
      expect(manager.getAvailableModels()).toHaveLength(4);
      expect(manager.getAvailableModels().map(m => m.id)).toContain('new');
    });

    it('бросает ошибку при дублировании id', () => {
      const duplicateModel: ModelConfig = {
        id: 'fast',
        name: 'Duplicate',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-dup',
        model: 'dup-model',
        taskTypes: ['chat']
      };
      expect(() => manager.addModel(duplicateModel)).toThrow('уже существует');
    });
  });

  describe('removeModel', () => {
    it('удаляет модель', () => {
      const initialCount = manager.getAvailableModels().length;
      manager.removeModel('powerful');
      expect(manager.getAvailableModels()).toHaveLength(initialCount - 1);
      expect(manager.getAvailableModels().map(m => m.id)).not.toContain('powerful');
    });

    it('бросает ошибку для несуществующей модели', () => {
      expect(() => manager.removeModel('nonexistent')).toThrow('Модель не найдена');
    });

    it('бросает ошибку при удалении единственной модели', () => {
      mockConfigManager.getModels.mockReturnValue([mockModels[0]]);
      const singleManager = new MultiModelManager(mockConfigManager);
      expect(() => singleManager.removeModel('fast')).toThrow('Нельзя удалить единственную модель');
    });

    it('переключает активную модель при удалении текущей', () => {
      expect(manager.getCurrentModelId()).toBe('fast');
      manager.removeModel('fast');
      expect(manager.getCurrentModelId()).not.toBe('fast');
      expect(manager.getCurrentModelId()).toBeTruthy();
    });
  });

  describe('updateModel', () => {
    it('обновляет поля модели', () => {
      manager.updateModel('fast', { name: 'Updated Fast' });
      const updated = manager.getAvailableModels().find(m => m.id === 'fast');
      expect(updated!.name).toBe('Updated Fast');
    });

    it('бросает ошибку для несуществующей модели', () => {
      expect(() => manager.updateModel('nonexistent', { name: 'X' })).toThrow('Модель не найдена');
    });
  });

  describe('dispose', () => {
    it('очищает состояние', () => {
      manager.dispose();
      expect(manager.getAvailableModels()).toHaveLength(0);
      expect(manager.getCurrentModelId()).toBeNull();
    });
  });
});
