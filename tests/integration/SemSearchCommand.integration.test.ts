import { CommandHandler } from '../../src/commands/CommandHandler';
import { FileSystemService } from '../../src/services/FileSystemService';
import { LLMProvider } from '../../src/services/LLMProvider';
import { ContextBuilder } from '../../src/services/ContextBuilder';
import { ProjectManager } from '../../src/services/ProjectManager';
import { MemoryStore } from '../../src/services/MemoryStore';
import { GitService } from '../../src/services/GitService';
import { SearchIndex } from '../../src/services/SearchIndex';
import { EmbeddingService } from '../../src/services/EmbeddingService';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('SemSearch Command Integration Tests', () => {
  let commandHandler: CommandHandler;
  let fsService: FileSystemService;
  let projectManager: ProjectManager;
  let memoryStore: MemoryStore;
  let gitService: GitService;
  let searchIndex: SearchIndex;
  let embeddingService: EmbeddingService;
  let testDir: string;

  const mockLLMProvider = {
    generate: jest.fn(),
  } as unknown as LLMProvider;

  const mockContextBuilder = {
    buildContext: jest.fn().mockResolvedValue({
      systemPrompt: 'Test context',
      metadata: {},
    }),
  } as unknown as ContextBuilder;

  beforeEach(async () => {
    fsService = new FileSystemService();
    projectManager = new ProjectManager(fsService);
    memoryStore = new MemoryStore();
    gitService = new GitService();

    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devil-semsearch-cmd-test-'));

    searchIndex = new SearchIndex(fsService);
    await searchIndex.initialize(testDir);

    embeddingService = new EmbeddingService();
    await embeddingService.initialize();

    searchIndex.setSemanticDependencies(embeddingService, memoryStore);

    await memoryStore.initialize(testDir);

    await fs.mkdir(path.join(testDir, 'src'));
    await fs.writeFile(
      path.join(testDir, 'src', 'test.ts'),
      'export function hello() { return "world"; }',
      'utf-8'
    );
    await fs.writeFile(path.join(testDir, 'package.json'), '{"name": "test-project"}', 'utf-8');

    const mockFolder = {
      uri: { fsPath: testDir },
      name: 'test-project',
      index: 0,
    } as vscode.WorkspaceFolder;

    await projectManager.setProject(mockFolder);

    commandHandler = new CommandHandler(
      fsService,
      mockLLMProvider,
      mockContextBuilder,
      projectManager,
      memoryStore,
      gitService,
      searchIndex,
      {} as any, // graphBuilder
      {} as any, // multiModelManager
      {} as any, // devPlanManager
      {} as any  // devPlanExecutor
    );
  });

  afterEach(async () => {
    await memoryStore.close();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('/semsearch command', () => {
    it('должен возвращать ошибку без аргументов', async () => {
      const result = await commandHandler.handleMessage('/semsearch');

      expect(result?.success).toBe(false);
      expect(result?.message).toContain('Использование: /semsearch <запрос>');
    });

    it('должен возвращать результаты семантического поиска', async () => {
      // Создаём узлы
      await memoryStore.addNode({
        type: 'decision',
        name: 'JWT для аутентификации',
        metadata: {
          why: 'Stateless подход',
          how_to_apply: 'Использовать jsonwebtoken'
        }
      });

      await memoryStore.addNode({
        type: 'technology',
        name: 'React',
        metadata: {
          description: 'Библиотека для UI'
        }
      });

      // Векторизуем
      await searchIndex.buildNodeEmbeddings();

      // Выполняем команду
      const result = await commandHandler.handleMessage('/semsearch как реализовать вход?');

      expect(result?.success).toBe(true);
      expect(result?.message).toContain('Найдено');
      expect(result?.message).toContain('релевантных записей');
    });

    it('должен показывать сообщение, если ничего не найдено', async () => {
      // Не создаём узлы, не векторизуем
      const result = await commandHandler.handleMessage('/semsearch любой запрос');

      expect(result?.success).toBe(true);
      expect(result?.message).toContain('Ничего не найдено');
    });
  });

  describe('/memory embeddings build command', () => {
    it('должен векторизовать узлы', async () => {
      // Создаём узлы
      await memoryStore.addNode({
        type: 'decision',
        name: 'Решение 1'
      });

      await memoryStore.addNode({
        type: 'concept',
        name: 'Концепция 2'
      });

      // Выполняем команду
      const result = await commandHandler.handleMessage('/memory embeddings build');

      expect(result?.success).toBe(true);
      expect(result?.message).toContain('Векторизовано 2 узлов');
    });

    it('должен показывать 0, если все узлы уже векторизованы', async () => {
      // Создаём узел и векторизуем
      const nodeId = await memoryStore.addNode({
        type: 'concept',
        name: 'Концепция'
      });

      await searchIndex.updateNodeEmbedding(nodeId);

      // Выполняем команду
      const result = await commandHandler.handleMessage('/memory embeddings build');

      expect(result?.success).toBe(true);
      expect(result?.message).toContain('Векторизовано 0 узлов');
    });
  });

  describe('/memory embeddings rebuild command', () => {
    it('должен перестраивать все embeddings', async () => {
      // Создаём узлы
      await memoryStore.addNode({
        type: 'decision',
        name: 'Решение 1'
      });

      await memoryStore.addNode({
        type: 'concept',
        name: 'Концепция 2'
      });

      // Векторизуем
      await searchIndex.buildNodeEmbeddings();

      // Выполняем команду
      const result = await commandHandler.handleMessage('/memory embeddings rebuild');

      expect(result?.success).toBe(true);
      expect(result?.message).toContain('Перестроено 2 embeddings');
    });
  });
});
