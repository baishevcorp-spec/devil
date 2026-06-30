import { LLMProvider } from '../../src/services/LLMProvider';
import { ConfigManager } from '../../src/services/ConfigManager';
import { LLMError, NetworkError } from '../../src/utils/errors';
import * as vscodeMock from '../__mocks__/vscode';

// Мок модуля 'vscode' через moduleNameMapper в jest.config.js

// Мок axios с поддержкой default import
let mockAxiosInstance: { post: jest.Mock; get: jest.Mock };

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(() => mockAxiosInstance),
    isAxiosError: jest.fn((error: any) => error?.isAxiosError === true),
  },
  isAxiosError: jest.fn((error: any) => error?.isAxiosError === true),
}));

// Импортируем axios после jest.mock
import axios from 'axios';

describe('LLMProvider', () => {
  let llmProvider: LLMProvider;
  let configManager: ConfigManager;

  beforeEach(() => {
    // Очищаем все моки перед каждым тестом
    jest.clearAllMocks();

    // Явно сбрасываем моки axios, не трогая vscode
    (axios.create as jest.Mock).mockReset();
    (axios.isAxiosError as unknown as jest.Mock).mockReset();
    (axios.isAxiosError as unknown as jest.Mock).mockImplementation(
      (error: any) => error?.isAxiosError === true
    );

    // Создаём свежий мок-инстанс для каждого теста
    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
    };

    // Настраиваем axios.create так, чтобы он возвращал наш мок-инстанс
    (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

    // Настраиваем конфигурацию
    vscodeMock.__clearConfig();
    vscodeMock.__setConfigValue('devil.baseUrl', 'https://api.openai.com/v1');
    vscodeMock.__setConfigValue('devil.apiKey', 'sk-test-key');
    vscodeMock.__setConfigValue('devil.model', 'gpt-4o-mini');
    vscodeMock.__setConfigValue('devil.maxRetries', 3);

    configManager = new ConfigManager();
    configManager.initialize();

    // Создаём LLMProvider (в конструкторе вызывается axios.create)
    llmProvider = new LLMProvider(configManager);
  });

  afterEach(() => {
    configManager.dispose();
  });

  describe('generate', () => {
    it('успешно получает ответ от LLM', async () => {
      const mockResponse = {
        data: {
          choices: [
            {
              message: { content: 'Привет, мир!' },
              finish_reason: 'stop',
            },
          ],
          model: 'gpt-4o-mini',
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        },
      };

      mockAxiosInstance.post.mockResolvedValueOnce(mockResponse);

      const result = await llmProvider.generate('Привет');

      expect(result.content).toBe('Привет, мир!');
      expect(result.model).toBe('gpt-4o-mini');
      expect(result.tokensUsed).toBe(15);
      expect(result.finishReason).toBe('stop');
    });

    it('повторяет запрос при ошибке 500', async () => {
      const error500 = {
        isAxiosError: true,
        response: {
          status: 500,
          data: { error: 'Internal server error' },
        },
        message: 'Request failed with status code 500',
      };

      const mockResponse = {
        data: {
          choices: [{ message: { content: 'Успех' }, finish_reason: 'stop' }],
          model: 'gpt-4o-mini',
          usage: { total_tokens: 10 },
        },
      };

      mockAxiosInstance.post.mockRejectedValueOnce(error500).mockResolvedValueOnce(mockResponse);

      (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);

      const result = await llmProvider.generate('Тест');

      expect(result.content).toBe('Успех');
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
    });

    it('бросает NetworkError при таймауте', async () => {
      const timeoutError = {
        isAxiosError: true,
        code: 'ECONNABORTED',
        message: 'Timeout',
      };

      mockAxiosInstance.post.mockRejectedValue(timeoutError);
      (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);

      await expect(llmProvider.generate('Тест')).rejects.toThrow(NetworkError);
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3); // maxRetries = 3
    });

    it('бросает LLMError при ошибке 429 (rate limit)', async () => {
      const error429 = {
        isAxiosError: true,
        response: {
          status: 429,
          data: { error: 'Rate limit exceeded' },
        },
        message: 'Request failed with status code 429',
      };

      mockAxiosInstance.post.mockRejectedValue(error429);
      (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);

      await expect(llmProvider.generate('Тест')).rejects.toThrow(LLMError);
    });

    it('бросает LLMError, если нет choices в ответе', async () => {
      const mockResponse = {
        data: {
          choices: [],
          model: 'gpt-4o-mini',
        },
      };

      mockAxiosInstance.post.mockResolvedValueOnce(mockResponse);

      await expect(llmProvider.generate('Тест')).rejects.toThrow(LLMError);
    });
  });

  describe('setters and getters', () => {
    it('setModel изменяет модель', () => {
      llmProvider.setModel('gpt-4o');
      expect(llmProvider.getModel()).toBe('gpt-4o');
    });

    it('setBaseUrl изменяет base URL', () => {
      llmProvider.setBaseUrl('https://api.example.com/v1');
      expect(llmProvider.getBaseUrl()).toBe('https://api.example.com/v1');
    });
  });
});
