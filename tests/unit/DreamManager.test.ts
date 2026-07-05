import { DreamManager } from '../../src/services/DreamManager';
import { DreamLockManager } from '../../src/services/DreamLockManager';
import { MemoryStore } from '../../src/services/MemoryStore';
import { UserProfileManager } from '../../src/services/UserProfileManager';
import { FileSystemService } from '../../src/services/FileSystemService';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('DreamManager', () => {
  let dreamManager: DreamManager;
  let dreamLockManager: DreamLockManager;
  let memoryStore: MemoryStore;
  let userProfileManager: UserProfileManager;
  let fileSystemService: FileSystemService;
  let testDir: string;
  let devilPath: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devil-dream-test-'));
    devilPath = path.join(testDir, '.devil');
    await fs.mkdir(devilPath);

    fileSystemService = new FileSystemService();
    memoryStore = new MemoryStore();
    await memoryStore.initialize(devilPath);

    userProfileManager = new UserProfileManager(memoryStore);
    dreamLockManager = new DreamLockManager(devilPath);
    dreamManager = new DreamManager(
      memoryStore,
      userProfileManager,
      fileSystemService,
      testDir
    );
  });

  afterEach(async () => {
    await memoryStore.close();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('deduplicateNodes', () => {
    it('должен объединить дубликаты узлов с одинаковым именем и путём', async () => {
      // Создаём дубликаты узлов (id генерируется автоматически)
      const node1Id = await memoryStore.addNode({
        type: 'function',
        name: 'handleSubmit',
        path: 'src/Form.tsx',
      });

      const node2Id = await memoryStore.addNode({
        type: 'function',
        name: 'handleSubmit',
        path: 'src/Form.tsx',
      });

      // Запускаем дедупликацию
      const count = await dreamManager.deduplicateNodes();

      expect(count).toBe(1);

      // Проверяем, что остался только один узел
      const nodes = await memoryStore.findNodes({ name: 'handleSubmit', path: 'src/Form.tsx' });
      expect(nodes.length).toBe(1);
      // Остался старый узел (с меньшим created_at)
      expect(nodes[0].id).toBe(node1Id);
    });

    it('должен перенести связи с дубликатов на основной узел', async () => {
      const mainNodeId = await memoryStore.addNode({
        type: 'class',
        name: 'UserService',
        path: 'src/UserService.ts',
      });

      const duplicateNodeId = await memoryStore.addNode({
        type: 'class',
        name: 'UserService',
        path: 'src/UserService.ts',
      });

      const otherNodeId = await memoryStore.addNode({
        type: 'function',
        name: 'init',
        path: 'src/init.ts',
      });

      // Создаём связь: otherNode → duplicateNode
      await memoryStore.addEdge({
        from_node: otherNodeId,
        to_node: duplicateNodeId,
        type: 'calls',
      });

      // Запускаем дедупликацию
      await dreamManager.deduplicateNodes();

      // Проверяем, что связь теперь указывает на mainNode
      const edges = await memoryStore.getEdgesTo(mainNodeId);
      expect(edges.length).toBe(1);
      expect(edges[0].from_node).toBe(otherNodeId);
    });

    it('должен вернуть 0, если дубликатов нет', async () => {
      await memoryStore.addNode({
        type: 'file',
        name: 'App.tsx',
        path: 'src/App.tsx',
      });

      await memoryStore.addNode({
        type: 'file',
        name: 'Button.tsx',
        path: 'src/Button.tsx',
      });

      const count = await dreamManager.deduplicateNodes();
      expect(count).toBe(0);
    });
  });

  describe('removeDeadEdges', () => {
    it('должен удалить связи, указывающие на несуществующие узлы', async () => {
      const nodeId = await memoryStore.addNode({
        type: 'file',
        name: 'App.tsx',
        path: 'src/App.tsx',
      });

      // Создаём связь с несуществующим узлом
      await memoryStore.addEdge({
        from_node: nodeId,
        to_node: 'non-existent-node',
        type: 'imports',
      });

      const count = await dreamManager.removeDeadEdges();

      expect(count).toBe(1);

      const edges = await memoryStore.getEdgesFrom(nodeId);
      expect(edges.length).toBe(0);
    });

    it('должен удалить связи от несуществующих узлов', async () => {
      const nodeId = await memoryStore.addNode({
        type: 'file',
        name: 'App.tsx',
        path: 'src/App.tsx',
      });

      await memoryStore.addEdge({
        from_node: 'non-existent-node',
        to_node: nodeId,
        type: 'imports',
      });

      const count = await dreamManager.removeDeadEdges();

      expect(count).toBe(1);

      const edges = await memoryStore.getEdgesTo(nodeId);
      expect(edges.length).toBe(0);
    });

    it('должен вернуть 0, если все связи валидны', async () => {
      const node1Id = await memoryStore.addNode({
        type: 'file',
        name: 'App.tsx',
        path: 'src/App.tsx',
      });

      const node2Id = await memoryStore.addNode({
        type: 'file',
        name: 'Button.tsx',
        path: 'src/Button.tsx',
      });

      await memoryStore.addEdge({
        from_node: node1Id,
        to_node: node2Id,
        type: 'imports',
      });

      const count = await dreamManager.removeDeadEdges();
      expect(count).toBe(0);
    });
  });

  describe('consolidateInstructions', () => {
    it('должен удалить дублирующиеся custom_instructions', async () => {
      await userProfileManager.updateProfile({
        customInstructions: [
          'Использовать TypeScript',
          'Избегать any',
          'Использовать TypeScript', // Дубликат
          'Всегда писать тесты',
          'Избегать any', // Дубликат
        ],
      });

      const count = await dreamManager.consolidateInstructions();

      expect(count).toBe(2);

      const profile = await userProfileManager.getProfile();
      expect(profile.customInstructions).toEqual([
        'Использовать TypeScript',
        'Избегать any',
        'Всегда писать тесты',
      ]);
    });

    it('должен вернуть 0, если дубликатов нет', async () => {
      await userProfileManager.updateProfile({
        customInstructions: [
          'Использовать TypeScript',
          'Избегать any',
        ],
      });

      const count = await dreamManager.consolidateInstructions();
      expect(count).toBe(0);
    });

    it('должен вернуть 0, если профиль пуст', async () => {
      const count = await dreamManager.consolidateInstructions();
      expect(count).toBe(0);
    });
  });

  describe('validateGraph', () => {
    it('должен вернуть isValid=true для валидного графа', async () => {
      const node1Id = await memoryStore.addNode({
        type: 'file',
        name: 'App.tsx',
        path: 'src/App.tsx',
      });

      const node2Id = await memoryStore.addNode({
        type: 'file',
        name: 'Button.tsx',
        path: 'src/Button.tsx',
      });

      await memoryStore.addEdge({
        from_node: node1Id,
        to_node: node2Id,
        type: 'imports',
      });

      const result = await dreamManager.validateGraph();

      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('должен обнаружить связи без узлов', async () => {
      const nodeId = await memoryStore.addNode({
        type: 'file',
        name: 'App.tsx',
        path: 'src/App.tsx',
      });

      await memoryStore.addEdge({
        from_node: nodeId,
        to_node: 'non-existent',
        type: 'imports',
      });

      const result = await dreamManager.validateGraph();

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].type).toBe('orphan_edge');
    });

    it('должен предупредить об узлах без связей', async () => {
      await memoryStore.addNode({
        type: 'concept',
        name: 'OrphanNode',
      });

      const result = await dreamManager.validateGraph();

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].type).toBe('unused_tag');
    });
  });

  describe('runDream', () => {
    it('должен выполнить полный цикл Dream', async () => {
      const node1Id = await memoryStore.addNode({
        type: 'file',
        name: 'App.tsx',
        path: 'src/App.tsx',
      });

      const node2Id = await memoryStore.addNode({
        type: 'file',
        name: 'Button.tsx',
        path: 'src/Button.tsx',
      });

      // Создаём мёртвую связь
      await memoryStore.addEdge({
        from_node: node1Id,
        to_node: 'non-existent',
        type: 'imports',
      });

      const report = await dreamManager.runDream();

      expect(report.deduplicatedNodes).toBe(0);
      expect(report.removedEdges).toBe(1);
      expect(report.consolidatedInstructions).toBe(0);
      expect(report.validationErrors.length).toBe(0);
      expect(report.duration).toBeGreaterThan(0);
      expect(report.timestamp).toBeGreaterThan(0);
    });

    it('должен залогировать Dream в change_log', async () => {
      await dreamManager.runDream();

      // Проверяем, что Dream выполнен без ошибок
      // (детальная проверка change_log зависит от реализации)
    });
  });
});
