import { GraphBuilder } from '../../src/services/GraphBuilder';
import { FileSystemService } from '../../src/services/FileSystemService';
import { MemoryStore } from '../../src/services/MemoryStore';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/**
 * Интеграционный тест для BCK-26: полный flow GraphBuilder → MemoryStore
 * Проверяет, что после парсинга проекта графовая память содержит узлы.
 */
describe('GraphBuilder Integration (BCK-26)', () => {
  let graphBuilder: GraphBuilder;
  let fsService: FileSystemService;
  let memoryStore: MemoryStore;
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devil-graph-integration-'));
    fsService = new FileSystemService();
    memoryStore = new MemoryStore();
    graphBuilder = new GraphBuilder(fsService, memoryStore);

    await memoryStore.initialize(testDir);

    // Создаём тестовые файлы
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'src', 'index.ts'),
      `export class MyClass {
        public myMethod(): void {
          console.log('hello');
        }
      }
      
      export function helperFunction(): number {
        return 42;
      }`,
      'utf-8'
    );
    await fs.writeFile(
      path.join(testDir, 'src', 'utils.ts'),
      `export const CONSTANT = 'value';`,
      'utf-8'
    );
  });

  afterEach(async () => {
    await memoryStore.close();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('после parseProject графовая память содержит узлы', async () => {
    // Получаем список файлов (абсолютные пути!)
    const tree = await fsService.scanDirectory(testDir);
    const files = fsService.collectFiles(tree, testDir);

    console.log('Test dir:', testDir);
    console.log('Files found:', files);
    console.log('Files count:', files.length);

    expect(files.length).toBeGreaterThan(0);

    // Проверяем, что файлы существуют
    for (const file of files) {
      const exists = await fsService.fileExists(file);
      console.log('File', file, 'exists:', exists);
      expect(exists).toBe(true);
    }

    // Парсим проект
    await graphBuilder.parseProject(testDir, files);

    // Проверяем, что графовая память не пуста
    const nodes = await memoryStore.findNodes({ limit: 50 });
    expect(nodes.length).toBeGreaterThan(0);

    // Проверяем наличие файла
    const fileNodes = nodes.filter(n => n.type === 'file');
    expect(fileNodes.length).toBeGreaterThan(0);

    // Проверяем наличие класса
    const classNodes = nodes.filter(n => n.type === 'class');
    expect(classNodes.some(n => n.name === 'MyClass')).toBe(true);

    // Проверяем наличие функции
    const functionNodes = nodes.filter(n => n.type === 'function');
    expect(functionNodes.some(n => n.name === 'helperFunction')).toBe(true);
  });

  it('при изменении файла граф обновляется через updateForFile', async () => {
    const tree = await fsService.scanDirectory(testDir);
    const files = fsService.collectFiles(tree, testDir);
    await graphBuilder.parseProject(testDir, files);

    // Изменяем файл
    const filePath = path.join(testDir, 'src', 'utils.ts');
    await fs.writeFile(
      filePath,
      `export const CONSTANT = 'value';
       export function newFunction(): void {}`,
      'utf-8'
    );

    // Обновляем граф для этого файла
    await graphBuilder.updateForFile(filePath, testDir);

    // Проверяем, что новая функция появилась в графе
    const nodes = await memoryStore.findNodes({ limit: 100 });
    const functionNodes = nodes.filter(n => n.type === 'function');
    expect(functionNodes.some(n => n.name === 'newFunction')).toBe(true);
  });
});
