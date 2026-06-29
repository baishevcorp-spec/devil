import { CommandHandler } from '../../src/commands/CommandHandler';
import { FileSystemService } from '../../src/services/FileSystemService';
import { LLMProvider } from '../../src/services/LLMProvider';
import { ContextBuilder } from '../../src/services/ContextBuilder';
import { ProjectManager } from '../../src/services/ProjectManager';
import { MemoryStore } from '../../src/services/MemoryStore';
import { GitService } from '../../src/services/GitService';
import { SearchIndex } from '../../src/services/SearchIndex';
import { MultiModelManager } from '../../src/services/MultiModelManager';
import { ConfigManager } from '../../src/services/ConfigManager';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('CommandHandler /model command', () => {
  let commandHandler: CommandHandler;
  let fsService: FileSystemService;
  let projectManager: ProjectManager;
  let memoryStore: MemoryStore;
  let gitService: GitService;
  let searchIndex: SearchIndex;
  let multiModelManager: MultiModelManager;
  let mockLLMProvider: any;
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devil-model-test-'));

    fsService = new FileSystemService();
    projectManager = new ProjectManager(fsService);
    memoryStore = new MemoryStore();
    gitService = new GitService();
    searchIndex = new SearchIndex(fsService);

    await searchIndex.initialize(testDir);
    await memoryStore.initialize(testDir);

    await fs.mkdir(path.join(testDir, 'src'));
    await fs.writeFile(
      path.join(testDir, 'src', 'test.ts'),
      'export function hello() { return "world"; }',
      'utf-8'
    );

    const mockFolder = {
      uri: { fsPath: testDir },
      name: 'test-project',
      index: 0,
    } as vscode.WorkspaceFolder;

    await projectManager.setProject(mockFolder);

    const mockConfigManager = {
      getBaseUrl: jest.fn().mockReturnValue('https://api.example.com/v1'),
      getApiKey: jest.fn().mockReturnValue('sk-test'),
      getModel: jest.fn().mockReturnValue('gpt-4o-mini'),
      getMaxRetries: jest.fn().mockReturnValue(3),
      getModels: jest.fn().mockReturnValue([
        {
          id: 'fast',
          name: 'GPT-4o Mini',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'sk-fast',
          model: 'gpt-4o-mini',
          taskTypes: ['chat', 'explain'],
          isDefault: true
        },
        {
          id: 'powerful',
          name: 'GPT-4o',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'sk-powerful',
          model: 'gpt-4o',
          taskTypes: ['refactor', 'generate']
        }
      ]),
      onConfigChanged: jest.fn(),
      dispose: jest.fn()
    } as unknown as ConfigManager;

    multiModelManager = new MultiModelManager(mockConfigManager);

    mockLLMProvider = {
      generate: jest.fn(),
      setModel: jest.fn(),
      setBaseUrl: jest.fn(),
      setApiKey: jest.fn(),
      applyModelConfig: jest.fn(),
      getModel: jest.fn().mockReturnValue('gpt-4o-mini'),
      getBaseUrl: jest.fn().mockReturnValue('https://api.example.com/v1')
    };

    const mockContextBuilder = {
      buildContext: jest.fn().mockResolvedValue({
        systemPrompt: 'Test context',
        metadata: {},
      }),
    } as unknown as ContextBuilder;

    commandHandler = new CommandHandler(
      fsService,
      mockLLMProvider as unknown as LLMProvider,
      mockContextBuilder,
      projectManager,
      memoryStore,
      gitService,
      searchIndex,
      undefined,
      multiModelManager
    );
  });

  afterEach(async () => {
    await memoryStore.close();
    multiModelManager.dispose();
    projectManager.dispose();
    await fs.rm(testDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  describe('/model switch (без аргументов)', () => {
    it('показывает список моделей в табличном виде', async () => {
      const result = await commandHandler.handleMessage('/model switch');

      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      expect(result!.message).toContain('Доступные модели LLM');
      expect(result!.message).toContain('fast');
      expect(result!.message).toContain('powerful');
      expect(result!.message).toContain('✅ активна');
    });
  });

  describe('/model switch <id>', () => {
    it('переключает активную модель', async () => {
      const result = await commandHandler.handleMessage('/model switch powerful');

      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      expect(result!.message).toContain('Модель переключена');
      expect(result!.message).toContain('GPT-4o');
      expect(mockLLMProvider.applyModelConfig).toHaveBeenCalled();
    });

    it('возвращает ошибку для несуществующей модели', async () => {
      const result = await commandHandler.handleMessage('/model switch nonexistent');

      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect(result!.message).toContain('Ошибка переключения');
    });
  });

  describe('/model current', () => {
    it('показывает текущую активную модель', async () => {
      const result = await commandHandler.handleMessage('/model current');

      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      expect(result!.message).toContain('Текущая активная модель');
      expect(result!.message).toContain('fast');
      expect(result!.message).toContain('gpt-4o-mini');
    });
  });

  describe('/model (без подкоманды)', () => {
    it('показывает подсказку по использованию', async () => {
      const result = await commandHandler.handleMessage('/model');

      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect(result!.message).toContain('Использование команды /model');
      expect(result!.message).toContain('/model switch');
    });
  });
});
