import { EmbeddingService } from '../../src/services/EmbeddingService';
import { GraphNode } from '../../src/interfaces/IMemoryStore';

describe('EmbeddingService', () => {
  let service: EmbeddingService;

  beforeAll(async () => {
    service = new EmbeddingService();
    // Загружаем модель один раз для всех тестов
    await service.initialize();
  }, 60000); // 60 сек на загрузку модели

  describe('initialize', () => {
    it('должен загрузить модель без ошибок', () => {
      // Если мы дошли сюда — модель загружена
      expect(service).toBeDefined();
    });
  });

  describe('generateEmbedding', () => {
    it('должен сгенерировать embedding размерностью 384', async () => {
      const embedding = await service.generateEmbedding(
        'React is a JavaScript library for building user interfaces'
      );

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });

    it('должен генерировать разные embeddings для разных текстов', async () => {
      const emb1 = await service.generateEmbedding('React library');
      const emb2 = await service.generateEmbedding('Python web framework');

      // Векторы должны различаться
      let sum = 0;
      for (let i = 0; i < emb1.length; i++) {
        sum += Math.abs(emb1[i] - emb2[i]);
      }
      expect(sum).toBeGreaterThan(0.1);
    });

    it('должен работать с длинным текстом (обрезка до 512 символов)', async () => {
      const longText = 'word '.repeat(200); // 1000 символов
      const embedding = await service.generateEmbedding(longText);

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });
  });

  describe('cosineSimilarity', () => {
    it('должен вернуть 1 для идентичных векторов', () => {
      const vec = new Float32Array([1, 0, 0, 0, 1]);
      const similarity = service.cosineSimilarity(vec, vec);
      expect(similarity).toBeCloseTo(1, 5);
    });

    it('должен вернуть 0 для ортогональных векторов', () => {
      const vec1 = new Float32Array([1, 0, 0]);
      const vec2 = new Float32Array([0, 1, 0]);
      const similarity = service.cosineSimilarity(vec1, vec2);
      expect(similarity).toBeCloseTo(0, 5);
    });

    it('должен показать высокое сходство для тематически близких текстов', async () => {
      const emb1 = await service.generateEmbedding('React is a JavaScript library');
      const emb2 = await service.generateEmbedding('Vue is a JavaScript framework');
      const emb3 = await service.generateEmbedding('The weather is sunny today');

      const sim12 = service.cosineSimilarity(emb1, emb2);
      const sim13 = service.cosineSimilarity(emb1, emb3);

      // React и Vue должны быть ближе, чем React и погода
      expect(sim12).toBeGreaterThan(sim13);
    });

    it('должен выбросить ошибку при разных размерностях', () => {
      const vec1 = new Float32Array([1, 0, 0]);
      const vec2 = new Float32Array([1, 0, 0, 0]);

      expect(() => service.cosineSimilarity(vec1, vec2)).toThrow(
        'Размерности векторов не совпадают'
      );
    });
  });

  describe('buildEmbeddingText', () => {
    it('должен включить имя узла', () => {
      const node: GraphNode = {
        id: 'test',
        type: 'decision',
        name: 'Использовать React',
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      const text = service.buildEmbeddingText(node);
      expect(text).toContain('Использовать React');
    });

    it('должен включить путь, why и how_to_apply', () => {
      const node: GraphNode = {
        id: 'test',
        type: 'decision',
        name: 'Использовать React',
        path: 'src/App.tsx',
        metadata: {
          why: 'Компонентный подход',
          how_to_apply: 'Все новые компоненты — функциональные',
        },
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      const text = service.buildEmbeddingText(node);
      expect(text).toContain('src/App.tsx');
      expect(text).toContain('Компонентный подход');
      expect(text).toContain('Все новые компоненты');
    });

    it('должен работать с пустым metadata', () => {
      const node: GraphNode = {
        id: 'test',
        type: 'file',
        name: 'test.ts',
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      const text = service.buildEmbeddingText(node);
      expect(text).toBe('test.ts');
    });
  });
});
