import { FileSystemService } from '../../src/services/FileSystemService';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';


describe('FileSystemService', () => {
  let fsService: FileSystemService;
  let testDir: string;

  beforeEach(async () => {
    fsService = new FileSystemService();
    
    // Создаём временную директорию для тестов
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devil-test-'));
  });

  afterEach(async () => {
    // Удаляем временную директорию
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('readFile', () => {
    it('читает содержимое файла', async () => {
      const filePath = path.join(testDir, 'test.txt');
      await fs.writeFile(filePath, 'Hello, World!', 'utf-8');

      const content = await fsService.readFile(filePath);
      expect(content).toBe('Hello, World!');
    });

    it('бросает ProjectError, если файл не существует', async () => {
      const filePath = path.join(testDir, 'nonexistent.txt');
      await expect(fsService.readFile(filePath)).rejects.toThrow();
    });
  });

  describe('writeFile', () => {
    it('записывает содержимое в файл', async () => {
      const filePath = path.join(testDir, 'output.txt');
      await fsService.writeFile(filePath, 'Test content');

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('Test content');
    });

    it('создаёт директории, если их нет', async () => {
      const filePath = path.join(testDir, 'nested', 'dir', 'file.txt');
      await fsService.writeFile(filePath, 'Nested content');

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('Nested content');
    });
  });

  describe('fileExists', () => {
    it('возвращает true, если файл существует', async () => {
      const filePath = path.join(testDir, 'exists.txt');
      await fs.writeFile(filePath, 'content', 'utf-8');

      const exists = await fsService.fileExists(filePath);
      expect(exists).toBe(true);
    });

    it('возвращает false, если файл не существует', async () => {
      const filePath = path.join(testDir, 'nonexistent.txt');
      const exists = await fsService.fileExists(filePath);
      expect(exists).toBe(false);
    });
  });

  describe('scanDirectory', () => {
    beforeEach(async () => {
      // Создаём тестовую структуру
      await fs.mkdir(path.join(testDir, 'src'));
      await fs.writeFile(path.join(testDir, 'src', 'index.ts'), 'console.log("hello")', 'utf-8');
      await fs.writeFile(path.join(testDir, 'README.md'), '# Test', 'utf-8');
      await fs.mkdir(path.join(testDir, 'node_modules'));
      await fs.writeFile(path.join(testDir, 'node_modules', 'package.json'), '{}', 'utf-8');
    });

    it('сканирует директорию и строит дерево', async () => {
      const tree = await fsService.scanDirectory(testDir);

      expect(tree.type).toBe('directory');
      expect(tree.children).toBeDefined();
      expect(tree.children!.length).toBeGreaterThan(0);

      // Проверяем, что node_modules исключён
      const nodeModules = tree.children!.find((c) => c.name === 'node_modules');
      expect(nodeModules).toBeUndefined();
    });

    it('исключает файлы по паттернам', async () => {
      const tree = await fsService.scanDirectory(testDir, {
        excludePatterns: ['node_modules', 'README.md']
      });

      const readme = tree.children!.find((c) => c.name === 'README.md');
      expect(readme).toBeUndefined();
    });

    it('ограничивает глубину рекурсии', async () => {
      // Создаём глубокую структуру
      await fs.mkdir(path.join(testDir, 'a', 'b', 'c', 'd'), { recursive: true });
      await fs.writeFile(path.join(testDir, 'a', 'b', 'c', 'd', 'deep.txt'), 'deep', 'utf-8');

      const tree = await fsService.scanDirectory(testDir, { maxDepth: 2 });

      // На глубине 2 директория 'a' должна иметь ребёнка 'b'
      const dirA = tree.children!.find((c) => c.name === 'a');
      expect(dirA).toBeDefined();
      expect(dirA!.children).toBeDefined();
      expect(dirA!.children!.length).toBeGreaterThan(0); // У 'a' есть ребёнок 'b'

      // Но у 'b' (глубина 2) уже не должно быть детей
      const dirB = dirA!.children!.find((c) => c.name === 'b');
      expect(dirB).toBeDefined();
      expect(dirB!.children).toBeDefined();
      expect(dirB!.children!.length).toBe(0); // Глубина ограничена
    });

    it('включает содержимое файлов, если includeContent = true', async () => {
      const tree = await fsService.scanDirectory(testDir, { includeContent: true });

      const readme = tree.children!.find((c) => c.name === 'README.md');
      expect(readme).toBeDefined();
      expect(readme!.content).toBe('# Test');
    });
  });

  describe('ensureDirectory', () => {
    it('создаёт директорию, если её нет', async () => {
      const dirPath = path.join(testDir, 'new', 'nested', 'dir');
      await fsService.ensureDirectory(dirPath);

      const exists = await fsService.fileExists(dirPath);
      expect(exists).toBe(true);
    });

    it('не бросает ошибку, если директория уже существует', async () => {
      const dirPath = path.join(testDir, 'existing');
      await fs.mkdir(dirPath);

      await expect(fsService.ensureDirectory(dirPath)).resolves.not.toThrow();
    });
  });
});
