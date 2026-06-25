import { ContextBuilder } from '../../src/services/ContextBuilder';
import { ProjectManager } from '../../src/services/ProjectManager';
import { FileSystemService } from '../../src/services/FileSystemService';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';


describe('ContextBuilder', () => {
  let contextBuilder: ContextBuilder;
  let projectManager: ProjectManager;
  let fsService: FileSystemService;
  let testDir: string;

  beforeEach(async () => {
    fsService = new FileSystemService();
    projectManager = new ProjectManager(fsService);
    
    // Создаём временную директорию для тестов
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devil-context-'));
    
    // Создаём тестовую структуру проекта
    await fs.mkdir(path.join(testDir, 'src'));
    await fs.writeFile(path.join(testDir, 'src', 'index.ts'), 'console.log("hello")', 'utf-8');
    await fs.writeFile(path.join(testDir, 'package.json'), '{"name": "test"}', 'utf-8');
    
    // Создаём .devil/ с Roadmap и чек-листом
    await fs.mkdir(path.join(testDir, '.devil'));
    await fs.writeFile(
      path.join(testDir, '.devil', 'roadmap.md'),
      '# Roadmap\n\n- [ ] Задача 1\n- [x] Задача 2',
      'utf-8'
    );
    await fs.writeFile(
      path.join(testDir, '.devil', 'checklist.md'),
      '# Чек-лист\n\n- [ ] Тест 1\n- [x] Тест 2',
      'utf-8'
    );

    // Инициализируем проект
    const mockFolder = {
      uri: { fsPath: testDir },
      name: 'test-project',
      index: 0
    } as any;

    await projectManager.setProject(mockFolder);

    contextBuilder = new ContextBuilder(projectManager, fsService, null);
  });

  afterEach(async () => {
    projectManager.dispose();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('buildContext', () => {
    it('строит контекст с информацией о проекте', async () => {
      const result = await contextBuilder.buildContext('Тестовый запрос');

      expect(result.systemPrompt).toContain('test-project');
      expect(result.systemPrompt).toContain('Тестовый запрос');
      expect(result.metadata.projectStructureIncluded).toBe(true);
    });

    it('включает структуру проекта', async () => {
      const result = await contextBuilder.buildContext('Тест', {
        includeProjectStructure: true
      });

      expect(result.systemPrompt).toContain('Структура проекта');
      expect(result.systemPrompt).toContain('src');
      expect(result.metadata.projectStructureIncluded).toBe(true);
    });

    it('исключает структуру проекта, если отключено', async () => {
      const result = await contextBuilder.buildContext('Тест', {
        includeProjectStructure: false
      });

      expect(result.metadata.projectStructureIncluded).toBe(false);
    });

    it('включает Roadmap', async () => {
      const result = await contextBuilder.buildContext('Тест', {
        includeRoadmap: true
      });

      expect(result.systemPrompt).toContain('Roadmap');
      expect(result.systemPrompt).toContain('Задача 1');
      expect(result.metadata.roadmapIncluded).toBe(true);
    });

    it('включает чек-лист', async () => {
      const result = await contextBuilder.buildContext('Тест', {
        includeChecklist: true
      });

      expect(result.systemPrompt).toContain('Чек-лист');
      expect(result.systemPrompt).toContain('Тест 1');
      expect(result.metadata.checklistIncluded).toBe(true);
    });

    it('ограничивает длину контекста', async () => {
      const result = await contextBuilder.buildContext('Тест', {
        maxContextLength: 100
      });

      expect(result.systemPrompt.length).toBeLessThanOrEqual(150); // 100 + обрезка
      expect(result.metadata.truncated).toBe(true);
    });

    it('возвращает минимальный контекст, если проект не открыт', async () => {
      const emptyProjectManager = new ProjectManager(fsService);
      const emptyContextBuilder = new ContextBuilder(emptyProjectManager, fsService, null);

      const result = await emptyContextBuilder.buildContext('Тест');

      expect(result.systemPrompt).toContain('Devil AI Assistant');
      expect(result.metadata.projectStructureIncluded).toBe(false);
    });
  });
});
