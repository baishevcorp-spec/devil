import { ConfigManager } from '../../src/services/ConfigManager';
import { ConfigError } from '../../src/utils/errors';
import * as vscodeMock from '../__mocks__/vscode';

// Мок модуля 'vscode' теперь настраивается через moduleNameMapper в jest.config.js
// Ручной jest.mock('vscode', ...) больше не нужен — это устраняет бесконечную рекурсию

describe('ConfigManager', () => {
  let configManager: ConfigManager;

  beforeEach(() => {
    vscodeMock.__clearConfig();
    configManager = new ConfigManager();
    configManager.initialize();
  });

  afterEach(() => {
    configManager.dispose();
  });

  describe('getConfig', () => {
    it('возвращает значения по умолчанию, если конфиг пуст', () => {
      const config = configManager.getConfig();
      expect(config.baseUrl).toBe('https://api.openai.com/v1');
      expect(config.model).toBe('gpt-4o-mini');
      expect(config.maxRetries).toBe(3);
      expect(config.apiKey).toBe('');
    });

    it('возвращает значения из settings.json', () => {
      vscodeMock.__setConfigValue('devil.baseUrl', 'https://api.myproxyapi.ru/v1');
      vscodeMock.__setConfigValue('devil.apiKey', 'sk-test-123');
      vscodeMock.__setConfigValue('devil.model', 'gpt-4o');

      const config = configManager.getConfig();
      expect(config.baseUrl).toBe('https://api.myproxyapi.ru/v1');
      expect(config.apiKey).toBe('sk-test-123');
      expect(config.model).toBe('gpt-4o');
    });
  });

  describe('validate', () => {
    it('бросает ConfigError, если apiKey пуст', () => {
      vscodeMock.__setConfigValue('devil.baseUrl', 'https://api.example.com/v1');
      vscodeMock.__setConfigValue('devil.apiKey', '');

      expect(() => configManager.validate()).toThrow(ConfigError);
    });

    it('бросает ConfigError, если baseUrl пуст', () => {
      vscodeMock.__setConfigValue('devil.baseUrl', '');
      vscodeMock.__setConfigValue('devil.apiKey', 'sk-test');

      expect(() => configManager.validate()).toThrow(ConfigError);
    });

    it('бросает ConfigError, если maxRetries вне диапазона', () => {
      vscodeMock.__setConfigValue('devil.baseUrl', 'https://api.example.com/v1');
      vscodeMock.__setConfigValue('devil.apiKey', 'sk-test');
      vscodeMock.__setConfigValue('devil.maxRetries', 99);

      expect(() => configManager.validate()).toThrow(ConfigError);
    });

    it('проходит валидацию при корректном конфиге', () => {
      vscodeMock.__setConfigValue('devil.baseUrl', 'https://api.example.com/v1');
      vscodeMock.__setConfigValue('devil.apiKey', 'sk-test');
      vscodeMock.__setConfigValue('devil.model', 'gpt-4o-mini');

      expect(() => configManager.validate()).not.toThrow();
      expect(configManager.isValid()).toBe(true);
    });
  });

  describe('getters', () => {
    beforeEach(() => {
      vscodeMock.__setConfigValue('devil.baseUrl', 'https://api.example.com/v1');
      vscodeMock.__setConfigValue('devil.apiKey', 'sk-test');
      vscodeMock.__setConfigValue('devil.model', 'claude-3');
      vscodeMock.__setConfigValue('devil.maxRetries', 5);
    });

    it('getBaseUrl возвращает baseUrl', () => {
      expect(configManager.getBaseUrl()).toBe('https://api.example.com/v1');
    });

    it('getApiKey возвращает apiKey', () => {
      expect(configManager.getApiKey()).toBe('sk-test');
    });

    it('getModel возвращает model', () => {
      expect(configManager.getModel()).toBe('claude-3');
    });

    it('getMaxRetries возвращает maxRetries', () => {
      expect(configManager.getMaxRetries()).toBe(5);
    });
  });
});
