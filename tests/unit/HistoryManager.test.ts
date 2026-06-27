import { HistoryManager } from '../../src/services/HistoryManager';
import { MemoryStore } from '../../src/services/MemoryStore';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('HistoryManager', () => {
  let historyManager: HistoryManager;
  let memoryStore: MemoryStore;
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devil-history-test-'));
    memoryStore = new MemoryStore();
    await memoryStore.initialize(testDir);
    historyManager = new HistoryManager(memoryStore);
    await historyManager.initialize(testDir);
  });

  afterEach(async () => {
    await memoryStore.close();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('addMessage', () => {
    it('добавляет сообщение в историю', async () => {
      await historyManager.addMessage('user', 'Привет!');

      const messages = await historyManager.getMessages();
      expect(messages.length).toBe(1);
      expect(messages[0].content).toBe('Привет!');
      expect(messages[0].role).toBe('user');
    });

    it('добавляет сообщение с метаданными', async () => {
      await historyManager.addMessage('assistant', 'Ответ', {
        tokensUsed: 150,
        model: 'gpt-4'
      });

      const messages = await historyManager.getMessages();
      expect(messages.length).toBe(1);
      expect(messages[0].metadata).toEqual({
        tokensUsed: 150,
        model: 'gpt-4'
      });
    });
  });

  describe('getMessages', () => {
    it('возвращает все сообщения', async () => {
      await historyManager.addMessage('user', 'Вопрос 1');
      await historyManager.addMessage('assistant', 'Ответ 1');
      await historyManager.addMessage('user', 'Вопрос 2');

      const messages = await historyManager.getMessages();
      expect(messages.length).toBe(3);
    });

    it('возвращает пустой массив, если история пуста', async () => {
      const messages = await historyManager.getMessages();
      expect(messages.length).toBe(0);
    });
  });

  describe('getRecentMessages', () => {
    it('возвращает последние N сообщений', async () => {
      for (let i = 0; i < 10; i++) {
        await historyManager.addMessage('user', 'Message ' + i);
      }

      const recent = await historyManager.getRecentMessages(5);
      expect(recent.length).toBe(5);
    });
  });

  describe('clearHistory', () => {
    it('очищает историю', async () => {
      await historyManager.addMessage('user', 'Тест');
      await historyManager.clearHistory();

      const messages = await historyManager.getMessages();
      expect(messages.length).toBe(0);
    });
  });

  describe('persistency', () => {
    it('сохраняет историю между сессиями', async () => {
      await historyManager.addMessage('user', 'Сохранённое сообщение');

      // Создаём новый HistoryManager с тем же MemoryStore
      const newHistoryManager = new HistoryManager(memoryStore);
      await newHistoryManager.initialize(testDir);

      const messages = await newHistoryManager.getMessages();
      expect(messages.length).toBe(1);
      expect(messages[0].content).toBe('Сохранённое сообщение');
    });
  });
});
