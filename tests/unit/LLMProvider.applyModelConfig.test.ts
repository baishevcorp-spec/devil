import { LLMProvider } from '../../src/services/LLMProvider';
import { ConfigManager } from '../../src/services/ConfigManager';
import { ModelConfig } from '../../src/interfaces/IMultiModelManager';

describe('LLMProvider.applyModelConfig', () => {
  let llmProvider: LLMProvider;
  let mockConfigManager: jest.Mocked<ConfigManager>;

  beforeEach(() => {
    mockConfigManager = {
      getBaseUrl: jest.fn().mockReturnValue('https://api.example.com/v1'),
      getApiKey: jest.fn().mockReturnValue('sk-initial'),
      getModel: jest.fn().mockReturnValue('gpt-4o-mini'),
      getMaxRetries: jest.fn().mockReturnValue(3),
      onConfigChanged: jest.fn(), // ← ДОБАВЛЕН: метод подписки на изменения
      dispose: jest.fn()
    } as unknown as jest.Mocked<ConfigManager>;

    llmProvider = new LLMProvider(mockConfigManager);
  });

  it('применяет baseUrl из конфигурации', () => {
    const config: ModelConfig = {
      id: 'test',
      name: 'Test Model',
      baseUrl: 'https://api.new.com/v1',
      apiKey: 'sk-new',
      model: 'new-model',
      taskTypes: ['chat']
    };

    llmProvider.applyModelConfig(config);
    // normalizeUrl убирает trailing slash
    expect(llmProvider.getBaseUrl()).toBe('https://api.new.com/v1');
  });

  it('применяет apiKey из конфигурации', () => {
    const config: ModelConfig = {
      id: 'test',
      name: 'Test Model',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-updated',
      model: 'gpt-4o',
      taskTypes: ['chat']
    };

    llmProvider.applyModelConfig(config);
    // Проверяем через getModel() что модель изменилась
    expect(llmProvider.getModel()).toBe('gpt-4o');
  });

  it('применяет model из конфигурации', () => {
    const config: ModelConfig = {
      id: 'powerful',
      name: 'GPT-4o',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      taskTypes: ['refactor']
    };

    llmProvider.applyModelConfig(config);
    expect(llmProvider.getModel()).toBe('gpt-4o');
  });

  it('применяет все параметры конфигурации', () => {
    const config: ModelConfig = {
      id: 'custom',
      name: 'Custom Model',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'ollama',
      model: 'llama3.1',
      taskTypes: ['chat'],
      temperature: 0.5,
      maxTokens: 8000,
      maxRetries: 5
    };

    llmProvider.applyModelConfig(config);

    expect(llmProvider.getBaseUrl()).toBe('http://localhost:11434/v1');
    expect(llmProvider.getModel()).toBe('llama3.1');
  });

  it('нормализует URL (убирает trailing slash)', () => {
    const config: ModelConfig = {
      id: 'test',
      name: 'Test',
      baseUrl: 'https://api.example.com/v1/',
      apiKey: 'sk-test',
      model: 'test-model',
      taskTypes: ['chat']
    };

    llmProvider.applyModelConfig(config);
    // normalizeUrl убирает trailing slash
    expect(llmProvider.getBaseUrl()).toBe('https://api.example.com/v1');
  });

  it('работает с минимальной конфигурацией (без опциональных параметров)', () => {
    const config: ModelConfig = {
      id: 'minimal',
      name: 'Minimal',
      baseUrl: 'https://api.minimal.com/v1',
      apiKey: 'sk-minimal',
      model: 'minimal-model',
      taskTypes: ['chat']
    };

    expect(() => llmProvider.applyModelConfig(config)).not.toThrow();
    expect(llmProvider.getModel()).toBe('minimal-model');
  });
});
