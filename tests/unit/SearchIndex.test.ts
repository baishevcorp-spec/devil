import { SearchIndex } from '../../src/services/SearchIndex';
import { FileSystemService } from '../../src/services/FileSystemService';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('SearchIndex', () => {
  let searchIndex: SearchIndex;
  let fsService: FileSystemService;
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devil-search-test-'));
    fsService = new FileSystemService();
    searchIndex = new SearchIndex(fsService);
    await searchIndex.initialize(testDir);
  });

  afterEach(async () => {
    await searchIndex.clear();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('initialize', () => {
    it('инициализирует индекс для проекта', async () => {
      const stats = await searchIndex.getStats();
      expect(stats.totalFiles).toBe(0);
      expect(stats.totalDocuments).toBe(0);
    });
  });

  describe('addToIndex', () => {
    it('добавляет файл в индекс', async () => {
      const filePath = path.join(testDir, 'test.ts');
      await fs.writeFile(filePath, 'export function hello() { return "world"; }', 'utf-8');

      await searchIndex.addToIndex(filePath);

      const stats = await searchIndex.getStats();
      expect(stats.totalFiles).toBe(1);
      expect(stats.totalDocuments).toBeGreaterThan(0);
    });

    it('индексирует каждую строку файла', async () => {
      const filePath = path.join(testDir, 'test.ts');
      const content = 'line1\nline2\nline3';
      await fs.writeFile(filePath, content, 'utf-8');

      await searchIndex.addToIndex(filePath);

      const stats = await searchIndex.getStats();
      expect(stats.totalDocuments).toBe(3);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      const file1 = path.join(testDir, 'file1.ts');
      const file2 = path.join(testDir, 'file2.ts');

      await fs.writeFile(file1, 'export function useEffect() {}', 'utf-8');
      await fs.writeFile(file2, 'const useState = () => {}', 'utf-8');

      await searchIndex.addToIndex(file1);
      await searchIndex.addToIndex(file2);
    });

    it('находит совпадения по запросу', async () => {
      const results = await searchIndex.search('useEffect');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].filePath).toBe('file1.ts');
      expect(results[0].content).toContain('useEffect');
    });

    it('возвращает результаты с подсветкой', async () => {
      const results = await searchIndex.search('useState');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].highlights.length).toBeGreaterThan(0);
    });

    it('поддерживает limit', async () => {
      const results = await searchIndex.search('use', { limit: 1 });

      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('фильтрует по паттерну файла', async () => {
      const results = await searchIndex.search('use', { filePattern: 'file1' });

      expect(results.every(r => r.filePath.includes('file1'))).toBe(true);
    });
  });

  describe('updateInIndex', () => {
    it('обновляет файл в индексе', async () => {
      const filePath = path.join(testDir, 'test.ts');
      await fs.writeFile(filePath, 'old content', 'utf-8');
      await searchIndex.addToIndex(filePath);

      await fs.writeFile(filePath, 'new content', 'utf-8');
      await searchIndex.updateInIndex(filePath);

      const results = await searchIndex.search('new');
      expect(results.length).toBeGreaterThan(0);

      const oldResults = await searchIndex.search('old');
      expect(oldResults.length).toBe(0);
    });
  });

  describe('removeFromIndex', () => {
    it('удаляет файл из индекса', async () => {
      const filePath = path.join(testDir, 'test.ts');
      await fs.writeFile(filePath, 'test content', 'utf-8');
      await searchIndex.addToIndex(filePath);

      await searchIndex.removeFromIndex(filePath);

      const stats = await searchIndex.getStats();
      expect(stats.totalFiles).toBe(0);
    });
  });

  describe('buildIndex', () => {
    it('строит индекс по всем файлам проекта', async () => {
      await fs.writeFile(path.join(testDir, 'file1.ts'), 'content1', 'utf-8');
      await fs.writeFile(path.join(testDir, 'file2.ts'), 'content2', 'utf-8');
      await fs.mkdir(path.join(testDir, 'subdir'));
      await fs.writeFile(path.join(testDir, 'subdir', 'file3.ts'), 'content3', 'utf-8');

      await searchIndex.buildIndex();

      const stats = await searchIndex.getStats();
      expect(stats.totalFiles).toBe(3);
    });

    it('исключает node_modules и .git', async () => {
      await fs.mkdir(path.join(testDir, 'node_modules'));
      await fs.writeFile(path.join(testDir, 'node_modules', 'lib.ts'), 'content', 'utf-8');
      await fs.mkdir(path.join(testDir, '.git'));
      await fs.writeFile(path.join(testDir, '.git', 'config'), 'content', 'utf-8');
      await fs.writeFile(path.join(testDir, 'file.ts'), 'content', 'utf-8');

      await searchIndex.buildIndex();

      const stats = await searchIndex.getStats();
      expect(stats.totalFiles).toBe(1);
    });
  });

  describe('getStats', () => {
    it('возвращает статистику индекса', async () => {
      await fs.writeFile(path.join(testDir, 'test.ts'), 'line1\nline2', 'utf-8');
      await searchIndex.addToIndex(path.join(testDir, 'test.ts'));

      const stats = await searchIndex.getStats();

      expect(stats.totalFiles).toBe(1);
      expect(stats.totalDocuments).toBe(2);
      expect(stats.indexSize).toBeGreaterThan(0);
    });
  });
});
