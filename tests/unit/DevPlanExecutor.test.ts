import { DevPlanExecutor } from '../../src/services/DevPlanExecutor';
import { FileSystemService } from '../../src/services/FileSystemService';
import { LLMProvider } from '../../src/services/LLMProvider';
import { ContextBuilder } from '../../src/services/ContextBuilder';
import { DevPlanManager } from '../../src/services/DevPlanManager';
import { DevStep, DevPlan } from '../../src/interfaces/IDevPlan';
import * as path from 'path';

// Моки
jest.mock('../../src/services/FileSystemService');
jest.mock('../../src/services/LLMProvider');
jest.mock('../../src/services/ContextBuilder');
jest.mock('../../src/services/DevPlanManager');

describe('DevPlanExecutor', () => {
  let devPlanExecutor: DevPlanExecutor;
  let mockFileSystemService: jest.Mocked<FileSystemService>;
  let mockLLMProvider: jest.Mocked<LLMProvider>;
  let mockContextBuilder: jest.Mocked<ContextBuilder>;
  let mockDevPlanManager: jest.Mocked<DevPlanManager>;

  beforeEach(() => {
    mockFileSystemService = new FileSystemService() as jest.Mocked<FileSystemService>;
    mockLLMProvider = new LLMProvider({} as any) as jest.Mocked<LLMProvider>;
    mockContextBuilder = new ContextBuilder(
      {} as any,
      mockFileSystemService,
      {} as any,
      {} as any
    ) as jest.Mocked<ContextBuilder>;
    mockDevPlanManager = new DevPlanManager(
      mockFileSystemService,
      mockLLMProvider,
      {} as any,
      mockContextBuilder
    ) as jest.Mocked<DevPlanManager>;

    devPlanExecutor = new DevPlanExecutor(
      mockFileSystemService,
      mockLLMProvider,
      mockContextBuilder,
      mockDevPlanManager
    );
  });

  describe('loadReferenceFiles', () => {
    it('должен загружать globalReferences и step.referenceFiles', async () => {
      const plan: DevPlan = {
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'in_progress',
        totalSteps: 2,
        completedSteps: 0,
        steps: [],
        globalReferences: ['.devil/references/brand-dna.md']
      };

      const step: DevStep = {
        id: 1,
        type: 'create_file',
        path: 'src/components/Button.tsx',
        description: 'Создать Button',
        status: 'pending',
        referenceFiles: ['.devil/references/design-system.md']
      };

      mockDevPlanManager.getCurrentPlan.mockReturnValue(plan);
      mockFileSystemService.fileExists.mockResolvedValue(true);
      mockFileSystemService.readFile.mockResolvedValue('# Brand DNA\n\nPrimary: #2563EB');

      const result = await (devPlanExecutor as any).loadReferenceFiles(step, '/test/project');

      expect(result.loaded).toHaveLength(2);
      expect(result.loaded[0].path).toBe('.devil/references/brand-dna.md');
      expect(result.loaded[1].path).toBe('.devil/references/design-system.md');
      expect(result.missing).toHaveLength(0);
    });

    it('должен дедуплицировать пути', async () => {
      const plan: DevPlan = {
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'in_progress',
        totalSteps: 1,
        completedSteps: 0,
        steps: [],
        globalReferences: ['.devil/references/brand-dna.md']
      };

      const step: DevStep = {
        id: 1,
        type: 'create_file',
        path: 'src/components/Button.tsx',
        description: 'Создать Button',
        status: 'pending',
        referenceFiles: ['.devil/references/brand-dna.md'] // Дубликат
      };

      mockDevPlanManager.getCurrentPlan.mockReturnValue(plan);
      mockFileSystemService.fileExists.mockResolvedValue(true);
      mockFileSystemService.readFile.mockResolvedValue('# Brand DNA');

      const result = await (devPlanExecutor as any).loadReferenceFiles(step, '/test/project');

      expect(result.loaded).toHaveLength(1); // Дедупликация
      expect(result.loaded[0].path).toBe('.devil/references/brand-dna.md');
    });

    it('должен нормализовать пути (Windows/Unix)', async () => {
      const plan: DevPlan = {
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'in_progress',
        totalSteps: 1,
        completedSteps: 0,
        steps: [],
        globalReferences: ['.devil\\references\\brand-dna.md'] // Windows path
      };

      const step: DevStep = {
        id: 1,
        type: 'create_file',
        path: 'src/components/Button.tsx',
        description: 'Создать Button',
        status: 'pending',
        referenceFiles: ['.devil/references/brand-dna.md'] // Unix path
      };

      mockDevPlanManager.getCurrentPlan.mockReturnValue(plan);
      mockFileSystemService.fileExists.mockResolvedValue(true);
      mockFileSystemService.readFile.mockResolvedValue('# Brand DNA');

      const result = await (devPlanExecutor as any).loadReferenceFiles(step, '/test/project');

      expect(result.loaded).toHaveLength(1); // Дедупликация после нормализации
      expect(result.loaded[0].path).toBe('.devil/references/brand-dna.md');
    });

    it('должен логировать отсутствующие файлы, но не блокировать работу', async () => {
      const plan: DevPlan = {
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'in_progress',
        totalSteps: 1,
        completedSteps: 0,
        steps: [],
        globalReferences: ['.devil/references/brand-dna.md', '.devil/references/missing.md']
      };

      const step: DevStep = {
        id: 1,
        type: 'create_file',
        path: 'src/components/Button.tsx',
        description: 'Создать Button',
        status: 'pending'
      };

      mockDevPlanManager.getCurrentPlan.mockReturnValue(plan);
      mockFileSystemService.fileExists
        .mockResolvedValueOnce(true)  // brand-dna.md существует
        .mockResolvedValueOnce(false); // missing.md не существует
      mockFileSystemService.readFile.mockResolvedValue('# Brand DNA');

      const result = await (devPlanExecutor as any).loadReferenceFiles(step, '/test/project');

      expect(result.loaded).toHaveLength(1);
      expect(result.loaded[0].path).toBe('.devil/references/brand-dna.md');
      expect(result.missing).toHaveLength(1);
      expect(result.missing[0]).toBe('.devil/references/missing.md');
    });
  });

  describe('formatReferenceReport', () => {
    it('должен форматировать отчёт о загруженных файлах', () => {
      const refContext = {
        loaded: [
          { path: '.devil/references/brand-dna.md', content: '# Brand DNA\n\nPrimary: #2563EB' },
          { path: '.devil/references/design-system.md', content: '# Design System' }
        ],
        missing: ['.devil/references/missing.md']
      };

      const report = (devPlanExecutor as any).formatReferenceReport(refContext);

      expect(report).toContain('📚 **Учтены reference-файлы:**');
      expect(report).toContain('.devil/references/brand-dna.md');
      expect(report).toContain('.devil/references/design-system.md');
      expect(report).toContain('⚠️ **Отсутствующие reference-файлы:**');
      expect(report).toContain('.devil/references/missing.md');
    });

    it('должен возвращать пустую строку, если нет файлов', () => {
      const refContext = {
        loaded: [],
        missing: []
      };

      const report = (devPlanExecutor as any).formatReferenceReport(refContext);

      expect(report).toBe('');
    });
  });
});
