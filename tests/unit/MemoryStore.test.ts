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

    it('создаёт все таблицы из схемы', async () => {
      // Проверяем через добавление данных в каждую таблицу
      const nodeId = await memoryStore.addNode({
        type: 'file',
        name: 'test.ts',
        path: 'src/test.ts',
        tags: ['frontend', 'test']
      });
      expect(nodeId).toBeTruthy();

      const tagId = await memoryStore.addTag('frontend');
      expect(tagId).toBeTruthy();

      await memoryStore.saveToCache({
        prompt_hash: 'test-hash',
        prompt: 'test prompt',
        response: 'test response',
        model: 'test-model',
        tokens_used: 100,
        created_at: Date.now(),
        expires_at: Date.now() + 604800000
      });

      await memoryStore.addDialogMessage({
        project_path: testDir,
        role: 'user',
        content: 'test message',
        metadata: {}
      });

      await memoryStore.addChangeLog({
        project_path: testDir,
        action: 'scan',
        target: 'project',
        metadata: {}
      });

      const profile = await memoryStore.getUserProfile();
      expect(profile).not.toBeNull();

      const migrations = await memoryStore.getAppliedMigrations();
      expect(migrations).toContain('001_initial_schema');
    });

    it('загружает существующую БД', async () => {
      const nodeId = await memoryStore.addNode({
        type: 'function',
        name: 'testFunc',
        path: 'src/test.ts',
        tags: []
      });
      await memoryStore.close();

      const newStore = new MemoryStore();
      await newStore.initialize(testDir);

      const node = await newStore.getNode(nodeId);
      expect(node).not.toBeNull();
      expect(node!.name).toBe('testFunc');

      await newStore.close();
    });
  });

  describe('Nodes', () => {
    it('добавляет узел и возвращает UUID', async () => {
      const id = await memoryStore.addNode({
        type: 'function',
        name: 'hello',
        path: 'src/test.ts',
        metadata: { line: 42, exported: true },
        tags: []
      });

      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(10);
    });

    it('получает узел по ID', async () => {
      const id = await memoryStore.addNode({
        type: 'class',
        name: 'MyClass',
        path: 'src/test.ts',
        tags: []
      });

      const node = await memoryStore.getNode(id);
      expect(node).not.toBeNull();
      expect(node!.type).toBe('class');
      expect(node!.name).toBe('MyClass');
      expect(node!.path).toBe('src/test.ts');
    });

    it('возвращает null для несуществующего узла', async () => {
      const node = await memoryStore.getNode('nonexistent-id');
      expect(node).toBeNull();
    });

    it('находит узлы по типу', async () => {
      await memoryStore.addNode({ type: 'function', name: 'func1', path: 'src/a.ts', tags: [] });
      await memoryStore.addNode({ type: 'function', name: 'func2', path: 'src/b.ts', tags: [] });
      await memoryStore.addNode({ type: 'class', name: 'Class1', path: 'src/c.ts', tags: [] });

      const functions = await memoryStore.findNodes({ type: 'function' });
      expect(functions.length).toBe(2);

      const classes = await memoryStore.findNodes({ type: 'class' });
      expect(classes.length).toBe(1);
    });

    it('находит узлы по имени (LIKE)', async () => {
      await memoryStore.addNode({ type: 'function', name: 'handleSubmit', path: 'src/a.ts', tags: [] });
      await memoryStore.addNode({ type: 'function', name: 'handleClick', path: 'src/b.ts', tags: [] });
      await memoryStore.addNode({ type: 'function', name: 'submit', path: 'src/c.ts', tags: [] });

      const results = await memoryStore.findNodes({ name: 'handle' });
      expect(results.length).toBe(2);
    });

    it('находит узлы по пути (LIKE)', async () => {
      await memoryStore.addNode({ type: 'file', name: 'a.ts', path: 'src/components/a.ts', tags: [] });
      await memoryStore.addNode({ type: 'file', name: 'b.ts', path: 'src/utils/b.ts', tags: [] });
      await memoryStore.addNode({ type: 'file', name: 'c.ts', path: 'src/components/c.ts', tags: [] });

      const results = await memoryStore.findNodes({ path: 'components' });
      expect(results.length).toBe(2);
    });

    it('находит узлы по тегу', async () => {
      const id1 = await memoryStore.addNode({ type: 'file', name: 'a.ts', path: 'src/a.ts', tags: [] });
      const id2 = await memoryStore.addNode({ type: 'file', name: 'b.ts', path: 'src/b.ts', tags: [] });
      await memoryStore.addNode({ type: 'file', name: 'c.ts', path: 'src/c.ts', tags: [] });

      await memoryStore.addTagToNode(id1, 'frontend');
      await memoryStore.addTagToNode(id2, 'frontend');

      const results = await memoryStore.findNodes({ tag: 'frontend' });
      expect(results.length).toBe(2);
    });

    it('поддерживает limit и offset', async () => {
      for (let i = 0; i < 10; i++) {
        await memoryStore.addNode({ type: 'function', name: 'func' + i, path: 'src/test.ts', tags: [] });
      }

      const first5 = await memoryStore.findNodes({ limit: 5 });
      expect(first5.length).toBe(5);

      const next5 = await memoryStore.findNodes({ limit: 5, offset: 5 });
      expect(next5.length).toBe(5);
    });

    it('обновляет узел', async () => {
      const id = await memoryStore.addNode({
        type: 'function',
        name: 'oldName',
        path: 'src/test.ts',
        tags: []
      });

      await memoryStore.updateNode(id, {
        name: 'newName',
        metadata: { updated: true }
      });

      const node = await memoryStore.getNode(id);
      expect(node!.name).toBe('newName');
      expect(node!.metadata).toEqual({ updated: true });
    });

    it('удаляет узел', async () => {
      const id = await memoryStore.addNode({
        type: 'function',
        name: 'toDelete',
        path: 'src/test.ts',
        tags: []
      });

      await memoryStore.deleteNode(id);

      const node = await memoryStore.getNode(id);
      expect(node).toBeNull();
    });

    it('получает узел по пути', async () => {
      await memoryStore.addNode({
        type: 'file',
        name: 'test.ts',
        path: 'src/test.ts',
        tags: []
      });

      const node = await memoryStore.getNodeByPath('src/test.ts');
      expect(node).not.toBeNull();
      expect(node!.name).toBe('test.ts');
    });

    it('получает узлы по имени', async () => {
      await memoryStore.addNode({ type: 'function', name: 'activate', path: 'src/a.ts', tags: [] });
      await memoryStore.addNode({ type: 'function', name: 'activate', path: 'src/b.ts', tags: [] });
      await memoryStore.addNode({ type: 'function', name: 'deactivate', path: 'src/c.ts', tags: [] });

      const nodes = await memoryStore.getNodeByName('activate');
      expect(nodes.length).toBe(3); // LIKE '%activate%' находит также 'deactivate'
    });

    it('добавляет узел с тегами', async () => {
      const id = await memoryStore.addNode({
        type: 'file',
        name: 'test.ts',
        path: 'src/test.ts',
        tags: ['frontend', 'test']
      });

      const node = await memoryStore.getNode(id);
      expect(node!.tags).toHaveLength(2);
      expect(node!.tags!.map(t => t.name)).toContain('frontend');
      expect(node!.tags!.map(t => t.name)).toContain('test');
    });
  });

  describe('Edges', () => {
    let fileId: string;
    let funcId: string;

    beforeEach(async () => {
      fileId = await memoryStore.addNode({ type: 'file', name: 'test.ts', path: 'src/test.ts', tags: [] });
      funcId = await memoryStore.addNode({ type: 'function', name: 'hello', path: 'src/test.ts', tags: [] });
    });

    it('добавляет связь и возвращает UUID', async () => {
      const id = await memoryStore.addEdge({
        from_node: fileId,
        to_node: funcId,
        type: 'contains',
        metadata: {}
      });

      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
    });

    it('получает связи, исходящие из узла', async () => {
      await memoryStore.addEdge({ from_node: fileId, to_node: funcId, type: 'contains', metadata: {} });

      const edges = await memoryStore.getEdgesFrom(fileId);
      expect(edges.length).toBe(1);
      expect(edges[0].type).toBe('contains');
      expect(edges[0].to_node).toBe(funcId);
    });

    it('получает связи, входящие в узел', async () => {
      await memoryStore.addEdge({ from_node: fileId, to_node: funcId, type: 'contains', metadata: {} });

      const edges = await memoryStore.getEdgesTo(funcId);
      expect(edges.length).toBe(1);
      expect(edges[0].from_node).toBe(fileId);
    });

    it('находит связи по типу', async () => {
      await memoryStore.addEdge({ from_node: fileId, to_node: funcId, type: 'contains', metadata: {} });
      await memoryStore.addEdge({ from_node: fileId, to_node: funcId, type: 'calls', metadata: {} });

      const contains = await memoryStore.findEdges({ type: 'contains' });
      expect(contains.length).toBe(1);
    });

    it('удаляет связь', async () => {
      const id = await memoryStore.addEdge({
        from_node: fileId,
        to_node: funcId,
        type: 'contains',
        metadata: {}
      });

      await memoryStore.deleteEdge(id);

      const edges = await memoryStore.findEdges({ from_node: fileId });
      expect(edges.length).toBe(0);
    });

    it('получает полный граф для файла', async () => {
      const otherFileId = await memoryStore.addNode({
        type: 'file',
        name: 'other.ts',
        path: 'src/other.ts',
        tags: []
      });

      await memoryStore.addEdge({ from_node: fileId, to_node: funcId, type: 'contains', metadata: {} });
      await memoryStore.addEdge({ from_node: otherFileId, to_node: fileId, type: 'imports', metadata: {} });

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

  describe('Tags', () => {
    it('добавляет тег', async () => {
      const id = await memoryStore.addTag('frontend');
      expect(id).toBeTruthy();
    });

    it('не создаёт дубликаты тегов', async () => {
      const id1 = await memoryStore.addTag('frontend');
      const id2 = await memoryStore.addTag('frontend');
      expect(id1).toBe(id2);
    });

    it('получает все теги', async () => {
      await memoryStore.addTag('frontend');
      await memoryStore.addTag('backend');
      await memoryStore.addTag('api');

      const tags = await memoryStore.getTags();
      expect(tags.length).toBe(3);
    });

    it('привязывает тег к узлу', async () => {
      const nodeId = await memoryStore.addNode({
        type: 'file',
        name: 'test.ts',
        path: 'src/test.ts',
        tags: []
      });

      await memoryStore.addTagToNode(nodeId, 'frontend');

      const tags = await memoryStore.getNodeTags(nodeId);
      expect(tags.length).toBe(1);
      expect(tags[0].name).toBe('frontend');
    });

    it('удаляет тег с узла', async () => {
      const nodeId = await memoryStore.addNode({
        type: 'file',
        name: 'test.ts',
        path: 'src/test.ts',
        tags: []
      });

      await memoryStore.addTagToNode(nodeId, 'frontend');
      await memoryStore.removeTagFromNode(nodeId, 'frontend');

      const tags = await memoryStore.getNodeTags(nodeId);
      expect(tags.length).toBe(0);
    });
  });

  describe('Cache', () => {
    it('сохраняет ответ LLM в кэш', async () => {
      await memoryStore.saveToCache({
        prompt_hash: 'test-hash-123',
        prompt: 'What is TypeScript?',
        response: 'TypeScript is a typed superset of JavaScript.',
        model: 'gpt-4',
        tokens_used: 150,
        created_at: Date.now(),
        expires_at: Date.now() + 604800000
      });

      const entry = await memoryStore.getFromCache('test-hash-123');
      expect(entry).not.toBeNull();
      expect(entry!.response).toBe('TypeScript is a typed superset of JavaScript.');
      expect(entry!.model).toBe('gpt-4');
      expect(entry!.tokens_used).toBe(150);
    });

    it('возвращает null для несуществующего хэша', async () => {
      const entry = await memoryStore.getFromCache('nonexistent-hash');
      expect(entry).toBeNull();
    });

    it('возвращает null для истёкной записи', async () => {
      await memoryStore.saveToCache({
        prompt_hash: 'expired-hash',
        prompt: 'test',
        response: 'test response',
        model: 'test-model',
        tokens_used: 10,
        created_at: Date.now() - 1000000,
        expires_at: Date.now() - 1000
      });

      const entry = await memoryStore.getFromCache('expired-hash');
      expect(entry).toBeNull();
    });

    it('очищает устаревшие записи', async () => {
      await memoryStore.saveToCache({
        prompt_hash: 'valid-hash',
        prompt: 'test',
        response: 'valid',
        model: 'test',
        tokens_used: 10,
        created_at: Date.now(),
        expires_at: Date.now() + 604800000
      });

      await memoryStore.saveToCache({
        prompt_hash: 'expired-hash',
        prompt: 'test',
        response: 'expired',
        model: 'test',
        tokens_used: 10,
        created_at: Date.now() - 1000000,
        expires_at: Date.now() - 1000
      });

      const cleared = await memoryStore.clearExpiredCache();
      expect(cleared).toBeGreaterThanOrEqual(1);

      const valid = await memoryStore.getFromCache('valid-hash');
      expect(valid).not.toBeNull();

      const expired = await memoryStore.getFromCache('expired-hash');
      expect(expired).toBeNull();
    });

    it('обновляет существующую запись (INSERT OR REPLACE)', async () => {
      await memoryStore.saveToCache({
        prompt_hash: 'same-hash',
        prompt: 'test',
        response: 'first',
        model: 'test',
        tokens_used: 10,
        created_at: Date.now(),
        expires_at: Date.now() + 604800000
      });

      await memoryStore.saveToCache({
        prompt_hash: 'same-hash',
        prompt: 'test',
        response: 'second',
        model: 'test',
        tokens_used: 20,
        created_at: Date.now(),
        expires_at: Date.now() + 604800000
      });

      const entry = await memoryStore.getFromCache('same-hash');
      expect(entry!.response).toBe('second');
      expect(entry!.tokens_used).toBe(20);
    });
  });

  describe('User Profile', () => {
    it('получает профиль по умолчанию', async () => {
      const profile = await memoryStore.getUserProfile();
      expect(profile).not.toBeNull();
      expect(profile!.id).toBe(1);
    });

    it('обновляет профиль', async () => {
      await memoryStore.updateUserProfile({
        coding_style: { indentStyle: 'tabs', indentSize: 4 },
        preferred_libraries: ['React', 'TypeScript'],
        preferred_patterns: ['Functional components'],
        custom_instructions: ['Use TypeScript']
      });

      const profile = await memoryStore.getUserProfile();
      expect(profile!.coding_style).toEqual({ indentStyle: 'tabs', indentSize: 4 });
      expect(profile!.preferred_libraries).toContain('React');
      expect(profile!.preferred_patterns).toContain('Functional components');
      expect(profile!.custom_instructions).toContain('Use TypeScript');
    });

    it('частично обновляет профиль', async () => {
      await memoryStore.updateUserProfile({
        preferred_libraries: ['Vue']
      });

      const profile = await memoryStore.getUserProfile();
      expect(profile!.preferred_libraries).toEqual(['Vue']);
    });
  });

  describe('Dialog History', () => {
    it('добавляет сообщение в историю', async () => {
      const id = await memoryStore.addDialogMessage({
        project_path: testDir,
        role: 'user',
        content: 'Привет!',
        metadata: {}
      });

      expect(id).toBeTruthy();
    });

    it('получает историю диалога для проекта', async () => {
      await memoryStore.addDialogMessage({
        project_path: testDir,
        role: 'user',
        content: 'Привет!',
        metadata: {}
      });
      await memoryStore.addDialogMessage({
        project_path: testDir,
        role: 'assistant',
        content: 'Привет! Чем могу помочь?',
        metadata: {}
      });

      const history = await memoryStore.getDialogHistory({ project_path: testDir });
      expect(history.length).toBe(2);
      expect(history[0].role).toBe('user');
      expect(history[1].role).toBe('assistant');
    });

    it('фильтрует историю по роли', async () => {
      await memoryStore.addDialogMessage({
        project_path: testDir,
        role: 'user',
        content: 'Вопрос 1',
        metadata: {}
      });
      await memoryStore.addDialogMessage({
        project_path: testDir,
        role: 'assistant',
        content: 'Ответ 1',
        metadata: {}
      });
      await memoryStore.addDialogMessage({
        project_path: testDir,
        role: 'user',
        content: 'Вопрос 2',
        metadata: {}
      });

      const userMessages = await memoryStore.getDialogHistory({
        project_path: testDir,
        role: 'user'
      });
      expect(userMessages.length).toBe(2);
    });

    it('поддерживает limit и offset', async () => {
      for (let i = 0; i < 10; i++) {
        await memoryStore.addDialogMessage({
          project_path: testDir,
          role: 'user',
          content: 'Message ' + i,
          metadata: {}
        });
      }

      const first5 = await memoryStore.getDialogHistory({
        project_path: testDir,
        limit: 5
      });
      expect(first5.length).toBe(5);
    });

    it('очищает историю для проекта', async () => {
      await memoryStore.addDialogMessage({
        project_path: testDir,
        role: 'user',
        content: 'test',
        metadata: {}
      });

      await memoryStore.clearDialogHistory(testDir);

      const history = await memoryStore.getDialogHistory({ project_path: testDir });
      expect(history.length).toBe(0);
    });

    it('не смешивает историю разных проектов', async () => {
      await memoryStore.addDialogMessage({
        project_path: testDir,
        role: 'user',
        content: 'Project 1',
        metadata: {}
      });
      await memoryStore.addDialogMessage({
        project_path: '/other/project',
        role: 'user',
        content: 'Project 2',
        metadata: {}
      });

      const history = await memoryStore.getDialogHistory({ project_path: testDir });
      expect(history.length).toBe(1);
      expect(history[0].content).toBe('Project 1');
    });
  });

  describe('Change Log', () => {
    it('добавляет запись в лог', async () => {
      const id = await memoryStore.addChangeLog({
        project_path: testDir,
        action: 'scan',
        target: 'project',
        description: 'Scanned project structure',
        metadata: {}
      });

      expect(id).toBeTruthy();
    });

    it('получает лог изменений для проекта', async () => {
      await memoryStore.addChangeLog({
        project_path: testDir,
        action: 'scan',
        target: 'project',
        metadata: {}
      });
      await memoryStore.addChangeLog({
        project_path: testDir,
        action: 'generate',
        target: 'roadmap.md',
        metadata: {}
      });

      const log = await memoryStore.getChangeLog({ project_path: testDir });
      expect(log.length).toBe(2);
    });

    it('фильтрует лог по действию', async () => {
      await memoryStore.addChangeLog({
        project_path: testDir,
        action: 'scan',
        target: 'project',
        metadata: {}
      });
      await memoryStore.addChangeLog({
        project_path: testDir,
        action: 'generate',
        target: 'roadmap.md',
        metadata: {}
      });
      await memoryStore.addChangeLog({
        project_path: testDir,
        action: 'scan',
        target: 'project',
        metadata: {}
      });

      const scans = await memoryStore.getChangeLog({
        project_path: testDir,
        action: 'scan'
      });
      expect(scans.length).toBe(2);
    });

    it('фильтрует лог по дням', async () => {
      await memoryStore.addChangeLog({
        project_path: testDir,
        action: 'scan',
        target: 'project',
        metadata: {}
      });

      const recent = await memoryStore.getChangeLog({
        project_path: testDir,
        days: 1
      });
      expect(recent.length).toBe(1);

      const old = await memoryStore.getChangeLog({
        project_path: testDir,
        days: -1
      });
      expect(old.length).toBe(0);
    });
  });

  describe('Migrations', () => {
    it('получает список применённых миграций', async () => {
      const migrations = await memoryStore.getAppliedMigrations();
      expect(migrations).toContain('001_initial_schema');
    });

    it('применяет новую миграцию', async () => {
      await memoryStore.applyMigration('002_add_feature');

      const migrations = await memoryStore.getAppliedMigrations();
      expect(migrations).toContain('002_add_feature');
    });

    it('не применяет миграцию повторно', async () => {
      await memoryStore.applyMigration('002_add_feature');
      await memoryStore.applyMigration('002_add_feature');

      const migrations = await memoryStore.getAppliedMigrations();
      const count = migrations.filter(m => m === '002_add_feature').length;
      expect(count).toBe(1);
    });
  });

  describe('Persistency', () => {
    it('сохраняет данные между сессиями', async () => {
      const nodeId = await memoryStore.addNode({
        type: 'function',
        name: 'persistent',
        path: 'src/test.ts',
        tags: []
      });

      await memoryStore.addTagToNode(nodeId, 'important');

      await memoryStore.saveToCache({
        prompt_hash: 'cache-test',
        prompt: 'test',
        response: 'cached',
        model: 'test',
        tokens_used: 10,
        created_at: Date.now(),
        expires_at: Date.now() + 604800000
      });

      await memoryStore.close();

      const newStore = new MemoryStore();
      await newStore.initialize(testDir);

      const node = await newStore.getNode(nodeId);
      expect(node).not.toBeNull();
      expect(node!.name).toBe('persistent');

      const tags = await newStore.getNodeTags(nodeId);
      expect(tags.length).toBe(1);

      const cached = await newStore.getFromCache('cache-test');
      expect(cached).not.toBeNull();
      expect(cached!.response).toBe('cached');

      await newStore.close();
    });
  });

  describe('Error handling', () => {
    it('бросает ошибку при неинициализированном хранилище', async () => {
      const emptyStore = new MemoryStore();
      await expect(emptyStore.addNode({ type: 'file', name: 'test.ts', path: 'src/test.ts', tags: [] }))
        .rejects.toThrow('MemoryStore не инициализирован');
    });

    it('бросает ошибку при невалидном типе узла', async () => {
      await expect(
        memoryStore.addNode({ type: 'invalid' as any, name: 'test', path: 'src/test.ts', tags: [] })
      ).rejects.toThrow();
    });

    it('бросает ошибку при невалидном типе связи', async () => {
      const id1 = await memoryStore.addNode({ type: 'file', name: 'a.ts', path: 'src/a.ts', tags: [] });
      const id2 = await memoryStore.addNode({ type: 'file', name: 'b.ts', path: 'src/b.ts', tags: [] });

      await expect(
        memoryStore.addEdge({ from_node: id1, to_node: id2, type: 'invalid' as any, metadata: {} })
      ).rejects.toThrow();
    });
  });
});
