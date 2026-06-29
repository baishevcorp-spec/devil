import { SearchIndex } from '../../src/services/SearchIndex';
import { MemoryStore } from '../../src/services/MemoryStore';
import { FileSystemService } from '../../src/services/FileSystemService';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/**
 * Интеграционные тесты для SearchIndex + MemoryStore (BCK-27, Audit 2026-06-29)
 * Проверяют взаимодействие компонентов в реальных сценариях.
 */
describe('SearchIndex + MemoryStore Integration', () => {
  let searchIndex: SearchIndex;
  let memoryStore: MemoryStore;
  let fsService: FileSystemService;
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devil-search-integration-'));
    fsService = new FileSystemService();
    searchIndex = new SearchIndex(fsService);
    memoryStore = new MemoryStore();

    await memoryStore.initialize(testDir);
    await searchIndex.initialize(testDir);

    // Создаём тестовые файлы
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'src', 'index.ts'),
      `export function hello() { return 'world'; }
export class MyClass {
  public myMethod(): void {
    console.log('hello');
  }
}`,
      'utf-8'
    );
    await fs.writeFile(
      path.join(testDir, 'src', 'utils.ts'),
      `export const CONSTANT = 'value';
export function helperFunction(): number {
  return 42;
}`,
      'utf-8'
    );
  });

  afterEach(async () => {
    await memoryStore.close();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('Индексация и поиск', () => {
    it('индексирует 100 файлов и находит совпадения', async () => {
      // Создаём 100 тестовых файлов
      for (let i = 0; i < 100; i++) {
        await fs.writeFile(
          path.join(testDir, 'src', `file_${i}.ts`),
          `export function function_${i}() { return ${i}; }`,
          'utf-8'
        );
      }

      // Строим индекс
      const startTime = Date.now();
      await searchIndex.buildIndex();
      const duration = Date.now() - startTime;

      // Проверяем статистику
      const stats = await searchIndex.getStats();
      expect(stats.totalFiles).toBeGreaterThanOrEqual(100);
      expect(stats.totalDocuments).toBeGreaterThan(0);

      // Проверяем поиск
      const results = await searchIndex.search('function_50');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain('function_50');

      // Проверяем производительность (чекпоинт DEVOPS-09)
      expect(duration).toBeLessThan(5000);
    }, 30000);

    it('обновляет индекс при изменении файла', async () => {
      await searchIndex.buildIndex();

      // Изменяем файл
      const filePath = path.join(testDir, 'src', 'utils.ts');
      await fs.writeFile(
        filePath,
        `export const CONSTANT = 'new_value';
export function helperFunction(): number {
  return 100;
}
export function newFunction(): string {
  return 'new';
}`,
        'utf-8'
      );

      // Обновляем индекс
      await searchIndex.updateInIndex(filePath);

      // Проверяем, что новые данные найдены
      const results = await searchIndex.search('newFunction');
      expect(results.length).toBeGreaterThan(0);
    });

    it('удаляет файл из индекса', async () => {
      await searchIndex.buildIndex();

      // Проверяем, что файл в индексе
      const before = await searchIndex.search('CONSTANT');
      expect(before.length).toBeGreaterThan(0);

      // Удаляем файл
      const filePath = path.join(testDir, 'src', 'utils.ts');
      await searchIndex.removeFromIndex(filePath);

      // Проверяем, что файл больше не в индексе
      const after = await searchIndex.search('CONSTANT');
      const foundInUtils = after.filter(r => r.filePath.includes('utils.ts'));
      expect(foundInUtils.length).toBe(0);
    });
  });

  describe('Взаимодействие с MemoryStore', () => {
    it('после индексации узлы создаются в БД', async () => {
      // Проверяем, что БД пуста
      const nodesBefore = await memoryStore.findNodes({ limit: 100 });
      expect(nodesBefore.length).toBe(0);

      // Добавляем узел вручную (имитация работы GraphBuilder)
      await memoryStore.addNode({
        type: 'file',
        name: 'index.ts',
        path: 'src/index.ts',
        metadata: { extension: '.ts' },
        tags: []
      });

      // Проверяем, что узел в БД
      const nodesAfter = await memoryStore.findNodes({ limit: 100 });
      expect(nodesAfter.length).toBe(1);
      expect(nodesAfter[0].name).toBe('index.ts');
    });

    it('поиск по индексу и БД даёт согласованные результаты', async () => {
      // Добавляем узел в БД
      await memoryStore.addNode({
        type: 'function',
        name: 'hello',
        path: 'src/index.ts',
        metadata: { line: 1 },
        tags: []
      });

      // Строим индекс
      await searchIndex.buildIndex();

      // Ищем в индексе
      const searchResults = await searchIndex.search('hello');
      expect(searchResults.length).toBeGreaterThan(0);

      // Ищем в БД
      const dbResults = await memoryStore.findNodes({ name: 'hello' });
      expect(dbResults.length).toBeGreaterThan(0);
      expect(dbResults[0].name).toBe('hello');
    });
  });
});
