import { MemoryStore } from '../../src/services/MemoryStore';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('MemoryStore', () => {
  let memoryStore: MemoryStore;
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devil-memory-test-'));
    memoryStore = new MemoryStore();
    await memoryStore.initialize(testDir);
  });

  afterEach(async () => {
    await memoryStore.close();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('initialize', () => {
    it('создаёт .devil/memory.db', async () => {
      const dbPath = path.join(testDir, '.devil', 'memory.db');
      const exists = await fs.access(dbPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('создаёт таблицы nodes, edges, project_info', async () => {
      // Проверяем через вставку данных
      const id = await memoryStore.addNode({
        type: 'file',
        name: 'test.ts',
        path: 'src/test.ts'
      });
      expect(id).toBeGreaterThan(0);
    });
  });

  describe('addNode', () => {
    it('добавляет узел и возвращает id', async () => {
      const id = await memoryStore.addNode({
        type: 'function',
        name: 'hello',
        path: 'src/test.ts',
        signature: 'function hello(): string'
      });

      expect(id).toBeGreaterThan(0);
    });

    it('сохраняет metadata как JSON', async () => {
      const id = await memoryStore.addNode({
        type: 'class',
        name: 'MyClass',
        path: 'src/test.ts',
        metadata: { methods: ['method1', 'method2'] }
      });

      const nodes = await memoryStore.findNodes({ name: 'MyClass' });
      expect(nodes.length).toBe(1);
      expect(nodes[0].metadata).toEqual({ methods: ['method1', 'method2'] });
    });
  });

  describe('findNodes', () => {
    beforeEach(async () => {
      await memoryStore.addNode({
        type: 'file',
        name: 'test.ts',
        path: 'src/test.ts'
      });
      await memoryStore.addNode({
        type: 'function',
        name: 'hello',
        path: 'src/test.ts'
      });
      await memoryStore.addNode({
        type: 'function',
        name: 'world',
        path: 'src/other.ts'
      });
    });

    it('находит все узлы без фильтров', async () => {
      const nodes = await memoryStore.findNodes({});
      expect(nodes.length).toBe(3);
    });

    it('фильтрует по типу', async () => {
      const nodes = await memoryStore.findNodes({ type: 'function' });
      expect(nodes.length).toBe(2);
    });

    it('фильтрует по имени (LIKE)', async () => {
      const nodes = await memoryStore.findNodes({ name: 'hello' });
      expect(nodes.length).toBe(1);
      expect(nodes[0].name).toBe('hello');
    });

    it('фильтрует по пути (LIKE)', async () => {
      const nodes = await memoryStore.findNodes({ path: 'src/test' });
      expect(nodes.length).toBe(2);
    });

    it('поддерживает limit', async () => {
      const nodes = await memoryStore.findNodes({ limit: 2 });
      expect(nodes.length).toBe(2);
    });
  });

  describe('addEdge', () => {
    it('добавляет связь между узлами', async () => {
      const fileId = await memoryStore.addNode({
        type: 'file',
        name: 'test.ts',
        path: 'src/test.ts'
      });
      const funcId = await memoryStore.addNode({
        type: 'function',
        name: 'hello',
        path: 'src/test.ts'
      });

      const edgeId = await memoryStore.addEdge({
        source_id: fileId,
        target_id: funcId,
        type: 'contains'
      });

      expect(edgeId).toBeGreaterThan(0);
    });
  });

  describe('findEdges', () => {
    let fileId: number;
    let funcId: number;

    beforeEach(async () => {
      fileId = await memoryStore.addNode({
        type: 'file',
        name: 'test.ts',
        path: 'src/test.ts'
      });
      funcId = await memoryStore.addNode({
        type: 'function',
        name: 'hello',
        path: 'src/test.ts'
      });
      await memoryStore.addEdge({
        source_id: fileId,
        target_id: funcId,
        type: 'contains'
      });
    });

    it('находит связи по source_id', async () => {
      const edges = await memoryStore.findEdges({ source_id: fileId });
      expect(edges.length).toBe(1);
      expect(edges[0].target_id).toBe(funcId);
    });

    it('находит связи по target_id', async () => {
      const edges = await memoryStore.findEdges({ target_id: funcId });
      expect(edges.length).toBe(1);
      expect(edges[0].source_id).toBe(fileId);
    });

    it('находит связи по типу', async () => {
      const edges = await memoryStore.findEdges({ type: 'contains' });
      expect(edges.length).toBe(1);
    });
  });

  describe('getNodeByPath', () => {
    it('возвращает узел по точному пути', async () => {
      await memoryStore.addNode({
        type: 'file',
        name: 'test.ts',
        path: 'src/test.ts'
      });

      const node = await memoryStore.getNodeByPath('src/test.ts');
      expect(node).not.toBeNull();
      expect(node!.name).toBe('test.ts');
    });

    it('возвращает null для несуществующего пути', async () => {
      const node = await memoryStore.getNodeByPath('nonexistent.ts');
      expect(node).toBeNull();
    });
  });

  describe('getNodeByName', () => {
    it('возвращает узлы по имени', async () => {
      await memoryStore.addNode({
        type: 'function',
        name: 'hello',
        path: 'src/test.ts'
      });
      await memoryStore.addNode({
        type: 'function',
        name: 'hello',
        path: 'src/other.ts'
      });

      const nodes = await memoryStore.getNodeByName('hello');
      expect(nodes.length).toBe(2);
    });
  });

  describe('getGraphForFile', () => {
    it('возвращает полный граф для файла', async () => {
      const fileId = await memoryStore.addNode({
        type: 'file',
        name: 'test.ts',
        path: 'src/test.ts'
      });
      const funcId = await memoryStore.addNode({
        type: 'function',
        name: 'hello',
        path: 'src/test.ts'
      });
      const classId = await memoryStore.addNode({
        type: 'class',
        name: 'MyClass',
        path: 'src/other.ts'
      });

      await memoryStore.addEdge({
        source_id: fileId,
        target_id: funcId,
        type: 'contains'
      });
      await memoryStore.addEdge({
        source_id: classId,
        target_id: fileId,
        type: 'imports'
      });

      const graph = await memoryStore.getGraphForFile('src/test.ts');
      
      expect(graph.node).not.toBeNull();
      expect(graph.node!.name).toBe('test.ts');
      expect(graph.outgoing.length).toBe(1);
      expect(graph.incoming.length).toBe(1);
      expect(graph.relatedNodes.length).toBe(2);
    });

    it('возвращает пустой граф для несуществующего файла', async () => {
      const graph = await memoryStore.getGraphForFile('nonexistent.ts');
      expect(graph.node).toBeNull();
      expect(graph.outgoing.length).toBe(0);
      expect(graph.incoming.length).toBe(0);
    });
  });

  describe('project_info', () => {
    it('сохраняет и загружает информацию о проекте', async () => {
      await memoryStore.updateProjectInfo({
        path: testDir,
        name: 'test-project'
      });

      const info = await memoryStore.getProjectInfo();
      expect(info).not.toBeNull();
      expect(info!.name).toBe('test-project');
      expect(info!.path).toBe(testDir);
    });

    it('обновляет существующую запись', async () => {
      await memoryStore.updateProjectInfo({
        path: testDir,
        name: 'old-name'
      });
      await memoryStore.updateProjectInfo({
        path: testDir,
        name: 'new-name'
      });

      const info = await memoryStore.getProjectInfo();
      expect(info!.name).toBe('new-name');
    });

    it('возвращает null, если проект не сохранён', async () => {
      const info = await memoryStore.getProjectInfo();
      expect(info).toBeNull();
    });
  });

  describe('clear', () => {
    it('удаляет все данные', async () => {
      await memoryStore.addNode({
        type: 'file',
        name: 'test.ts',
        path: 'src/test.ts'
      });
      await memoryStore.updateProjectInfo({
        path: testDir,
        name: 'test-project'
      });

      await memoryStore.clear();

      const nodes = await memoryStore.findNodes({});
      expect(nodes.length).toBe(0);

      const info = await memoryStore.getProjectInfo();
      expect(info).toBeNull();
    });
  });

  describe('persistency', () => {
    it('сохраняет данные между сессиями', async () => {
      await memoryStore.addNode({
        type: 'function',
        name: 'persistent',
        path: 'src/test.ts'
      });
      await memoryStore.close();

      // Создаём новый инстанс и инициализируем ту же директорию
      const newStore = new MemoryStore();
      await newStore.initialize(testDir);

      const nodes = await newStore.findNodes({ name: 'persistent' });
      expect(nodes.length).toBe(1);
      expect(nodes[0].name).toBe('persistent');

      await newStore.close();
    });
  });
});
