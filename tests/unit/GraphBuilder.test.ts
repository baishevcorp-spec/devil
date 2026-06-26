import { GraphBuilder } from '../../src/services/GraphBuilder';
import { FileSystemService } from '../../src/services/FileSystemService';
import { MemoryStore } from '../../src/services/MemoryStore';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('GraphBuilder', () => {
  let graphBuilder: GraphBuilder;
  let fsService: FileSystemService;
  let memoryStore: MemoryStore;
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devil-graph-test-'));
    fsService = new FileSystemService();
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
      expect(result.nodes[0].type).toBe('file');
      expect(result.nodes[0].name).toBe('test.ts');
    });

    it('извлекает классы', async () => {
      const filePath = path.join(testDir, 'test.ts');
      await fs.writeFile(filePath, 'export class MyClass {}', 'utf-8');

      const result = await graphBuilder.parseFile(filePath, testDir);

      const classNode = result.nodes.find(n => n.type === 'class');
      expect(classNode).toBeDefined();
      expect(classNode!.name).toBe('MyClass');
    });

    it('извлекает функции', async () => {
      const filePath = path.join(testDir, 'test.ts');
      await fs.writeFile(filePath, 'export function hello() {}', 'utf-8');

      const result = await graphBuilder.parseFile(filePath, testDir);

      const funcNode = result.nodes.find(n => n.type === 'function' && n.name === 'hello');
      expect(funcNode).toBeDefined();
    });

    it('извлекает интерфейсы', async () => {
      const filePath = path.join(testDir, 'test.ts');
      await fs.writeFile(filePath, 'export interface MyInterface {}', 'utf-8');

      const result = await graphBuilder.parseFile(filePath, testDir);

      const interfaceNode = result.nodes.find(n => n.type === 'interface');
      expect(interfaceNode).toBeDefined();
      expect(interfaceNode!.name).toBe('MyInterface');
    });

    it('извлекает типы', async () => {
      const filePath = path.join(testDir, 'test.ts');
      await fs.writeFile(filePath, 'export type MyType = string;', 'utf-8');

      const result = await graphBuilder.parseFile(filePath, testDir);

      const typeNode = result.nodes.find(n => n.type === 'type');
      expect(typeNode).toBeDefined();
      expect(typeNode!.name).toBe('MyType');
    });

    it('извлекает экспортируемые переменные', async () => {
      const filePath = path.join(testDir, 'test.ts');
      await fs.writeFile(filePath, 'export const myVar = 5;', 'utf-8');

      const result = await graphBuilder.parseFile(filePath, testDir);

      const varNode = result.nodes.find(n => n.type === 'variable');
      expect(varNode).toBeDefined();
      expect(varNode!.name).toBe('myVar');
    });

    it('создаёт связи contains для символов', async () => {
      const filePath = path.join(testDir, 'test.ts');
      await fs.writeFile(filePath, 'export class MyClass {}', 'utf-8');

      const result = await graphBuilder.parseFile(filePath, testDir);

      expect(result.edges.length).toBeGreaterThan(0);
      expect(result.edges[0].type).toBe('contains');
    });

    it('пропускает не-TS/JS файлы', async () => {
      const filePath = path.join(testDir, 'test.txt');
      await fs.writeFile(filePath, 'Hello world', 'utf-8');

      const result = await graphBuilder.parseFile(filePath, testDir);

      // Только узел файла, без символов
      expect(result.nodes.length).toBe(1);
      expect(result.nodes[0].type).toBe('file');
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
      // 2 файла + 1 класс + 1 функция = 4 узла
      expect(nodes.length).toBe(4);
    });
  });
});
