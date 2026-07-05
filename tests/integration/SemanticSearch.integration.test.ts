import { SearchIndex } from '../../src/services/SearchIndex';
import { EmbeddingService } from '../../src/services/EmbeddingService';
import { MemoryStore } from '../../src/services/MemoryStore';
import { FileSystemService } from '../../src/services/FileSystemService';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('Semantic Search Integration Tests', () => {
  let searchIndex: SearchIndex;
  let embeddingService: EmbeddingService;
  let memoryStore: MemoryStore;
  let fsService: FileSystemService;
  let testDir: string;

  beforeEach(async () => {
    // Создаём временную директорию
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devil-semantic-test-'));

    // Инициализируем сервисы
    fsService = new FileSystemService();
    memoryStore = new MemoryStore();
    await memoryStore.initialize(testDir);

    embeddingService = new EmbeddingService();
    await embeddingService.initialize();

    searchIndex = new SearchIndex(fsService);
    await searchIndex.initialize(testDir);
    searchIndex.setSemanticDependencies(embeddingService, memoryStore);
  });

  afterEach(async () => {
    await memoryStore.close();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('buildNodeEmbeddings', () => {
    it('должен векторизовать все узлы без embeddings', async () => {
      // Создаём тестовые узлы
      const nodeId1 = await memoryStore.addNode({
        type: 'decision',
        name: 'Использовать React',
        path: 'src/App.tsx',
        metadata: {
          why: 'Компонентный подход упрощает разработку',
          how_to_apply: 'Все новые компоненты — функциональные'
        }
      });

      const nodeId2 = await memoryStore.addNode({
        type: 'technology',
        name: 'TypeScript',
        metadata: {
          description: 'Строгая типизация для JavaScript'
        }
      });

      // Векторизуем
      const count = await searchIndex.buildNodeEmbeddings();

      expect(count).toBe(2);

      // Проверяем, что embeddings сохранены
      const embedding1 = await memoryStore.getNodeEmbedding(nodeId1);
      const embedding2 = await memoryStore.getNodeEmbedding(nodeId2);

      expect(embedding1).not.toBeNull();
      expect(embedding2).not.toBeNull();
      expect(embedding1!.embedding.length).toBe(384);
      expect(embedding2!.embedding.length).toBe(384);
    });

    it('должен вернуть 0, если все узлы уже векторизованы', async () => {
      // Создаём узел и векторизуем
      const nodeId = await memoryStore.addNode({
        type: 'concept',
        name: 'SOLID'
      });

      await searchIndex.updateNodeEmbedding(nodeId);

      // Повторная векторизация
      const count = await searchIndex.buildNodeEmbeddings();

      expect(count).toBe(0);
    });
  });

  describe('searchMemory', () => {
    it('должен находить релевантные узлы по смыслу', async () => {
      // Создаём узлы с разным смыслом
      const nodeId1 = await memoryStore.addNode({
        type: 'decision',
        name: 'JWT для аутентификации',
        metadata: {
          why: 'Stateless подход упрощает масштабирование',
          how_to_apply: 'Использовать jsonwebtoken пакет'
        }
      });

      const nodeId2 = await memoryStore.addNode({
        type: 'technology',
        name: 'PostgreSQL',
        metadata: {
          description: 'Реляционная база данных для хранения данных'
        }
      });

      const nodeId3 = await memoryStore.addNode({
        type: 'decision',
        name: 'OAuth2 для авторизации',
        metadata: {
          why: 'Стандарт для делегированного доступа',
          how_to_apply: 'Использовать passport.js'
        }
      });

      // Векторизуем
      await searchIndex.buildNodeEmbeddings();

      // Ищем по смыслу
      const results = await searchIndex.searchMemory('как реализовать вход в систему?', 10);

      expect(results.length).toBeGreaterThan(0);
      
      // JWT и OAuth2 должны быть в результатах (они про аутентификацию)
      const nodeIds = results.map(r => r.node.id);
      expect(nodeIds).toContain(nodeId1);
      expect(nodeIds).toContain(nodeId3);
      
      // PostgreSQL должен быть ниже в рейтинге (он про БД, не про аутентификацию)
      const jwtScore = results.find(r => r.node.id === nodeId1)?.similarity || 0;
      const pgScore = results.find(r => r.node.id === nodeId2)?.similarity || 0;
      
      expect(jwtScore).toBeGreaterThan(pgScore);
    });

    it('должен возвращать пустой массив, если нет embeddings', async () => {
      const results = await searchIndex.searchMemory('любой запрос', 10);
      expect(results).toEqual([]);
    });

    it('должен ограничивать количество результатов через topK', async () => {
      // Создаём 10 узлов
      for (let i = 0; i < 10; i++) {
        await memoryStore.addNode({
          type: 'concept',
          name: `Концепция ${i}`
        });
      }

      await searchIndex.buildNodeEmbeddings();

      const results = await searchIndex.searchMemory('концепция', 5);
      expect(results.length).toBe(5);
    });
  });

  describe('updateNodeEmbedding', () => {
    it('должен обновлять embedding при изменении узла', async () => {
      const nodeId = await memoryStore.addNode({
        type: 'decision',
        name: 'Старое решение'
      });

      await searchIndex.updateNodeEmbedding(nodeId);
      const embedding1 = await memoryStore.getNodeEmbedding(nodeId);

      // Обновляем узел
      await memoryStore.updateNode(nodeId, {
        name: 'Новое решение',
        metadata: { why: 'Новая причина' }
      });

      await searchIndex.updateNodeEmbedding(nodeId);
      const embedding2 = await memoryStore.getNodeEmbedding(nodeId);

      // Embeddings должны различаться
      expect(embedding1!.textHash).not.toBe(embedding2!.textHash);
    });

    it('должен выбрасывать ошибку для несуществующего узла', async () => {
      await expect(
        searchIndex.updateNodeEmbedding('non-existent-id')
      ).rejects.toThrow('Узел не найден');
    });
  });

  describe('rebuildNodeEmbeddings', () => {
    it('должен перестраивать все embeddings', async () => {
      // Создаём узлы
      const nodeId1 = await memoryStore.addNode({
        type: 'decision',
        name: 'Решение 1'
      });

      const nodeId2 = await memoryStore.addNode({
        type: 'concept',
        name: 'Концепция 2'
      });

      // Векторизуем
      await searchIndex.buildNodeEmbeddings();

      // Перестраиваем
      const count = await searchIndex.rebuildNodeEmbeddings();

      expect(count).toBe(2);

      // Проверяем, что embeddings обновлены
      const embedding1 = await memoryStore.getNodeEmbedding(nodeId1);
      const embedding2 = await memoryStore.getNodeEmbedding(nodeId2);

      expect(embedding1).not.toBeNull();
      expect(embedding2).not.toBeNull();
    });
  });
});
