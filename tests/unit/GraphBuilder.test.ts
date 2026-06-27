import { GraphBuilder } from '../../src/services/GraphBuilder';
import { FileSystemService } from '../../src/services/FileSystemService';
import { MemoryStore } from '../../src/services/MemoryStore';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('GraphBuilder', () => {
  let graphBuilder: GraphBuilder;
  let memoryStore: MemoryStore;
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devil-graph-test-'));
    const fsService = new FileSystemService();
    memoryStore = new MemoryStore();
    await memoryStore.initialize(testDir);
    graphBuilder = new GraphBuilder(fsService, memoryStore);
  });

  afterEach(async () => {
    await memoryStore.close();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('parseFile', () => {
    it('создаёт узел для файла', async () => {
      const filePath = path.join(testDir, 'test.ts');
      await fs.writeFile(filePath, 'export const x = 5;', 'utf-8');

      const result = await graphBuilder.parseFile(filePath, testDir);

      expect(result.nodes.length).toBeGreaterThan(0);

      const fileNode = await memoryStore.getNode(result.nodes[0]);
      expect(fileNode).not.toBeNull();
      expect(fileNode!.type).toBe('file');
      expect(fileNode!.name).toBe('test.ts');
    });

    it('извлекает классы', async () => {
      const filePath = path.join(testDir, 'test.ts');
      await fs.writeFile(filePath, 'export class MyClass {}', 'utf-8');

      await graphBuilder.parseFile(filePath, testDir);

      const nodes = await memoryStore.findNodes({ type: 'class' });
      const classNode = nodes.find(n => n.name === 'MyClass');
      expect(classNode).toBeDefined();
    });

    it('извлекает функции', async () => {
      const filePath = path.join(testDir, 'test.ts');
      await fs.writeFile(filePath, 'export function hello() {}', 'utf-8');

      await graphBuilder.parseFile(filePath, testDir);

      const nodes = await memoryStore.findNodes({ type: 'function', name: 'hello' });
      expect(nodes.length).toBeGreaterThan(0);
    });

    it('извлекает интерфейсы', async () => {
      const filePath = path.join(testDir, 'test.ts');
      await fs.writeFile(filePath, 'export interface MyInterface {}', 'utf-8');

      await graphBuilder.parseFile(filePath, testDir);

      const nodes = await memoryStore.findNodes({ name: 'MyInterface' });
      expect(nodes.length).toBeGreaterThan(0);
    });

    it('извлекает типы', async () => {
      const filePath = path.join(testDir, 'test.ts');
      await fs.writeFile(filePath, 'export type MyType = string;', 'utf-8');

      await graphBuilder.parseFile(filePath, testDir);

      const nodes = await memoryStore.findNodes({ name: 'MyType' });
      expect(nodes.length).toBeGreaterThan(0);
    });

    it('извлекает экспортируемые переменные', async () => {
      const filePath = path.join(testDir, 'test.ts');
      await fs.writeFile(filePath, 'export const myVar = 5;', 'utf-8');

      await graphBuilder.parseFile(filePath, testDir);

      const nodes = await memoryStore.findNodes({ type: 'variable', name: 'myVar' });
      expect(nodes.length).toBeGreaterThan(0);
    });

    it('создаёт связи contains для символов', async () => {
      const filePath = path.join(testDir, 'test.ts');
      await fs.writeFile(filePath, 'export class MyClass {}', 'utf-8');

      const result = await graphBuilder.parseFile(filePath, testDir);

      // Должно быть хотя бы 2 узла (файл + класс) и связь
      expect(result.nodes.length).toBeGreaterThanOrEqual(2);
      expect(result.edges.length).toBeGreaterThan(0);
    });

    it('пропускает не-TS/JS файлы', async () => {
      const filePath = path.join(testDir, 'test.txt');
      await fs.writeFile(filePath, 'Hello world', 'utf-8');

      const result = await graphBuilder.parseFile(filePath, testDir);

      expect(result.nodes.length).toBe(1);

      const fileNode = await memoryStore.getNode(result.nodes[0]);
      expect(fileNode!.type).toBe('file');
    });
  });

  describe('parseProject', () => {
    it('парсит несколько файлов', async () => {
      const file1 = path.join(testDir, 'file1.ts');
      const file2 = path.join(testDir, 'file2.ts');
      await fs.writeFile(file1, 'export class A {}', 'utf-8');
      await fs.writeFile(file2, 'export function b() {}', 'utf-8');

      await graphBuilder.parseProject(testDir, [file1, file2]);

      const nodes = await memoryStore.findNodes({});
      expect(nodes.length).toBeGreaterThanOrEqual(4);
    });
  });
});
