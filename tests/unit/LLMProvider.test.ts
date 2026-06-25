import { LLMProvider } from '../../src/services/LLMProvider';
import { ConfigManager } from '../../src/services/ConfigManager';
import { LLMError, NetworkError } from '../../src/utils/errors';
import axios from 'axios';
import * as vscodeMock from '../__mocks__/vscode';

// Мокаем axios
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    post: jest.fn(),
    get: jest.fn()
  })),
  isAxiosError: jest.fn((error) => error.isAxiosError === true)
}));

describe('LLMProvider', () => {
  let llmProvider: LLMProvider;
  let configManager: ConfigManager;
  let mockAxiosInstance: { post: jest.Mock; get: jest.Mock };

  beforeEach(() => {
    vscodeMock.__clearConfig();
    vscodeMock.__setConfigValue('devil.baseUrl', 'https://api.openai.com/v1');
    vscodeMock.__setConfigValue('devil.apiKey', 'sk-test-key');
    vscodeMock.__setConfigValue('devil.model', 'gpt-4o-mini');
    vscodeMock.__setConfigValue('devil.maxRetries', 3);

    configManager = new ConfigManager();
    configManager.initialize();

    llmProvider = new LLMProvider(configManager);

    // Получаем мок axios instance
    mockAxiosInstance = (axios.create as jest.Mock)();
  });

  afterEach(() => {
    configManager.dispose();
    jest.clearAllMocks();
  });

  describe('generate', () => {
    it('успешно получает ответ от LLM', async () => {
      const mockResponse = {
        data: {
          choices: [
            {
              message: { content: 'Привет, мир!' },
              finish_reason: 'stop'
            }
          ],
          model: 'gpt-4o-mini',
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15
          }
        }
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
          data: { error: 'Internal server error' }
        }
      };

      const mockResponse = {
        data: {
          choices: [{ message: { content: 'Успех' }, finish_reason: 'stop' }],
          model: 'gpt-4o-mini',
          usage: { total_tokens: 10 }
        }
      };

      mockAxiosInstance.post
        .mockRejectedValueOnce(error500)
        .mockResolvedValueOnce(mockResponse);

      (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);

      const result = await llmProvider.generate('Тест');

      expect(result.content).toBe('Успех');
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
    });

    it('бросает NetworkError при таймауте', async () => {
      const timeoutError = {
        isAxiosError: true,
        code: 'ECONNABORTED',
        message: 'Timeout'
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
          data: { error: 'Rate limit exceeded' }
        }
      };

      mockAxiosInstance.post.mockRejectedValue(error429);
      (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);

      await expect(llmProvider.generate('Тест')).rejects.toThrow(LLMError);
    });

    it('бросает LLMError, если нет choices в ответе', async () => {
      const mockResponse = {
        data: {
          choices: [],
          model: 'gpt-4o-mini'
        }
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
