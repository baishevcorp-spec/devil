import { CommandHandler } from '../../src/commands/CommandHandler';
import { FileSystemService } from '../../src/services/FileSystemService';
import { LLMProvider } from '../../src/services/LLMProvider';
import { ContextBuilder } from '../../src/services/ContextBuilder';
import { ProjectManager } from '../../src/services/ProjectManager';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('CommandHandler Integration Tests', () => {
  let commandHandler: CommandHandler;
  let fsService: FileSystemService;
  let projectManager: ProjectManager;
  let testDir: string;

  const mockLLMProvider = {
    generate: jest.fn(),
  } as unknown as LLMProvider;

  const mockContextBuilder = {
    buildContext: jest.fn().mockResolvedValue({
      systemPrompt: 'Test context',
      metadata: {},
    }),
  } as unknown as ContextBuilder;

  beforeEach(async () => {
    fsService = new FileSystemService();
    projectManager = new ProjectManager(fsService);

    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devil-cmd-test-'));

    await fs.mkdir(path.join(testDir, 'src'));
    await fs.writeFile(
      path.join(testDir, 'src', 'test.ts'),
      'export function hello() { return "world"; }',
      'utf-8'
    );
    await fs.writeFile(path.join(testDir, 'package.json'), '{"name": "test-project"}', 'utf-8');

    const mockFolder = {
      uri: { fsPath: testDir },
      name: 'test-project',
      index: 0,
    } as vscode.WorkspaceFolder;

    await projectManager.setProject(mockFolder);

    commandHandler = new CommandHandler(
      fsService,
      mockLLMProvider,
      mockContextBuilder,
      projectManager
    );
  });

  afterEach(async () => {
    projectManager.dispose();
    await fs.rm(testDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  describe('/help command', () => {
    it('возвращает список команд', async () => {
      const result = await commandHandler.handleMessage('/help');

      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      expect(result!.message).toContain('Доступные команды');
      expect(result!.message).toContain('/scan');
      expect(result!.message).toContain('/explain');
      expect(result!.message).toContain('/roadmap');
      expect(result!.message).toContain('/view');
    });
  });

  describe('/scan command', () => {
    it('читает существующий файл', async () => {
      const result = await commandHandler.handleMessage('/scan src/test.ts');

      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      expect(result!.message).toContain('Содержимое файла');
      expect(result!.message).toContain('hello');
    });

    it('возвращает ошибку для несуществующего файла', async () => {
      const result = await commandHandler.handleMessage('/scan nonexistent.ts');

      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect(result!.message).toContain('Файл не найден');
    });

    it('возвращает ошибку без аргументов', async () => {
      const result = await commandHandler.handleMessage('/scan');

      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect(result!.message).toContain('Использование');
    });
  });

  describe('/explain command', () => {
    beforeEach(() => {
      (mockLLMProvider.generate as jest.Mock).mockResolvedValue({
        content: 'Это тестовое объяснение кода',
        tokensUsed: 100,
        model: 'test-model',
      });
    });

    it('объясняет весь файл', async () => {
      const result = await commandHandler.handleMessage('/explain src/test.ts');

      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      expect(result!.message).toContain('Объяснение кода');
      expect(result!.message).toContain('тестовое объяснение');
      expect(mockLLMProvider.generate).toHaveBeenCalled();
    });

    it('объясняет выделенный код с разделителем ---', async () => {
      const selectedCode = 'function hello()';
      const result = await commandHandler.handleMessage('/explain src/test.ts --- ' + selectedCode);

      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);

      const callArgs = (mockLLMProvider.generate as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toContain(selectedCode);
      expect(callArgs[0]).toContain('выделенный фрагмент');
    });

    it('возвращает ошибку для несуществующего файла', async () => {
      const result = await commandHandler.handleMessage('/explain nonexistent.ts');

      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect(result!.message).toContain('Файл не найден');
    });
  });

  describe('/roadmap generate command', () => {
    beforeEach(() => {
      (mockLLMProvider.generate as jest.Mock).mockResolvedValue({
        content: '# Roadmap\n\n## Этап 1\n- Задача 1\n- Задача 2',
        tokensUsed: 500,
        model: 'test-model',
      });
    });

    it('генерирует и сохраняет Roadmap', async () => {
      const result = await commandHandler.handleMessage('/roadmap generate');

      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      expect(result!.message).toContain('Roadmap сгенерирован');
      expect(result!.message).toContain('.devil/roadmap.md');

      const roadmapPath = path.join(testDir, '.devil', 'roadmap.md');
      const exists = await fsService.fileExists(roadmapPath);
      expect(exists).toBe(true);

      const content = await fsService.readFile(roadmapPath);
      expect(content).toContain('# Roadmap');
      expect(content).toContain('Этап 1');
    });

    it('возвращает ошибку без аргумента generate', async () => {
      const result = await commandHandler.handleMessage('/roadmap');

      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect(result!.message).toContain('Использование');
    });
  });

  describe('/checklist generate command', () => {
    beforeEach(() => {
      (mockLLMProvider.generate as jest.Mock).mockResolvedValue({
        content: '# Чек-лист\n\n- [ ] `src/test.ts` — тестовый файл',
        tokensUsed: 300,
        model: 'test-model',
      });
    });

    it('генерирует и сохраняет чек-лист', async () => {
      const result = await commandHandler.handleMessage('/checklist generate');

      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      expect(result!.message).toContain('Чек-лист сгенерирован');
      expect(result!.message).toContain('.devil/checklist.md');

      const checklistPath = path.join(testDir, '.devil', 'checklist.md');
      const exists = await fsService.fileExists(checklistPath);
      expect(exists).toBe(true);

      const content = await fsService.readFile(checklistPath);
      expect(content).toContain('# Чек-лист');
      expect(content).toContain('src/test.ts');
    });
  });

  describe('/view command', () => {
    it('показывает Roadmap, если файл существует', async () => {
      await fs.mkdir(path.join(testDir, '.devil'), { recursive: true });
      await fs.writeFile(
        path.join(testDir, '.devil', 'roadmap.md'),
        '# Roadmap\n\n## Этап 1\n- Задача 1',
        'utf-8'
      );

      const result = await commandHandler.handleMessage('/view roadmap');

      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      expect(result!.message).toContain('Roadmap проекта');
      expect(result!.message).toContain('Этап 1');
    });

    it('показывает чек-лист, если файл существует', async () => {
      await fs.mkdir(path.join(testDir, '.devil'), { recursive: true });
      await fs.writeFile(
        path.join(testDir, '.devil', 'checklist.md'),
        '# Чек-лист\n\n- [ ] src/test.ts — тест',
        'utf-8'
      );

      const result = await commandHandler.handleMessage('/view checklist');

      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      expect(result!.message).toContain('Чек-лист файлов');
      expect(result!.message).toContain('src/test.ts');
    });

    it('возвращает ошибку, если файл не найден', async () => {
      const result = await commandHandler.handleMessage('/view roadmap');

      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect(result!.message).toContain('Файл не найден');
      expect(result!.message).toContain('/roadmap generate');
    });

    it('возвращает подсказку без аргументов', async () => {
      const result = await commandHandler.handleMessage('/view');

      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect(result!.message).toContain('/view roadmap');
      expect(result!.message).toContain('/view checklist');
    });

    it('поддерживает произвольный путь к файлу', async () => {
      await fs.mkdir(path.join(testDir, '.devil'), { recursive: true });
      await fs.writeFile(path.join(testDir, '.devil', 'custom.md'), '# Custom\n\nContent', 'utf-8');

      const result = await commandHandler.handleMessage('/view custom.md');

      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      expect(result!.message).toContain('Custom');
    });
  });

  describe('Неизвестные команды', () => {
    it('возвращает ошибку для неизвестной команды', async () => {
      const result = await commandHandler.handleMessage('/unknown');

      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect(result!.message).toContain('Неизвестная команда');
      expect(result!.message).toContain('/help');
    });
  });

  describe('Обычные сообщения (не команды)', () => {
    it('возвращает null для сообщений без /', async () => {
      const result = await commandHandler.handleMessage('Привет, как дела?');

      expect(result).toBeNull();
    });
  });
});
