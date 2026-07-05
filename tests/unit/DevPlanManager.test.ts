import { DevPlanManager } from '../../src/services/DevPlanManager';
import { FileSystemService } from '../../src/services/FileSystemService';
import { LLMProvider } from '../../src/services/LLMProvider';
import { ProjectManager } from '../../src/services/ProjectManager';
import { ContextBuilder } from '../../src/services/ContextBuilder';
import { DevPlan, DevStep } from '../../src/interfaces/IDevPlan';
import * as path from 'path';

// Моки
jest.mock('../../src/services/FileSystemService');
jest.mock('../../src/services/LLMProvider');
jest.mock('../../src/services/ProjectManager');
jest.mock('../../src/services/ContextBuilder');

describe('DevPlanManager', () => {
  let devPlanManager: DevPlanManager;
  let mockFileSystemService: jest.Mocked<FileSystemService>;
  let mockLLMProvider: jest.Mocked<LLMProvider>;
  let mockProjectManager: jest.Mocked<ProjectManager>;
  let mockContextBuilder: jest.Mocked<ContextBuilder>;

  beforeEach(() => {
    mockFileSystemService = new FileSystemService() as jest.Mocked<FileSystemService>;
    mockLLMProvider = new LLMProvider({} as any) as jest.Mocked<LLMProvider>;
    mockProjectManager = new ProjectManager(mockFileSystemService) as jest.Mocked<ProjectManager>;
    mockContextBuilder = new ContextBuilder(
      mockProjectManager,
      mockFileSystemService,
      {} as any,
      {} as any
    ) as jest.Mocked<ContextBuilder>;

    devPlanManager = new DevPlanManager(
      mockFileSystemService,
      mockLLMProvider,
      mockProjectManager,
      mockContextBuilder
    );

    // Мокаем getCurrentProject
    mockProjectManager.getCurrentProject.mockReturnValue({
      name: 'test-project',
      path: '/test/project',
      devilPath: '/test/project/.devil',
      fileCount: 10,
      structure: null
    });
  });

  describe('scanReferencesDirectory', () => {
    it('должен вернуть пустой массив, если папка references не существует', async () => {
      mockFileSystemService.fileExists.mockResolvedValue(false);

      const result = await (devPlanManager as any).scanReferencesDirectory();

      expect(result).toEqual([]);
      expect(mockFileSystemService.fileExists).toHaveBeenCalledWith(
        path.join('/test/project/.devil', 'references')
      );
    });

    it('должен вернуть список .md файлов из папки references', async () => {
      mockFileSystemService.fileExists.mockResolvedValue(true);
      mockFileSystemService.scanDirectory.mockResolvedValue({
        name: 'references',
        path: '/test/project/.devil/references',
        type: 'directory',
        children: [
          { name: 'brand-dna.md', path: '/test/project/.devil/references/brand-dna.md', type: 'file' },
          { name: 'design-system.md', path: '/test/project/.devil/references/design-system.md', type: 'file' },
          { name: 'notes.txt', path: '/test/project/.devil/references/notes.txt', type: 'file' }
        ]
      });

      const result = await (devPlanManager as any).scanReferencesDirectory();

      expect(result).toHaveLength(2);
      expect(result).toContain('.devil/references/brand-dna.md');
      expect(result).toContain('.devil/references/design-system.md');
      expect(result).not.toContain('.devil/references/notes.txt');
    });
  });

  describe('assignReferencesToSteps', () => {
    it('должен добавить brand-dna.md и design-system.md к UI-компонентам', () => {
      const plan: DevPlan = {
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'draft',
        totalSteps: 3,
        completedSteps: 0,
        steps: [
          {
            id: 1,
            type: 'create_file',
            path: 'src/components/Button.tsx',
            description: 'Создать Button',
            status: 'pending'
          },
          {
            id: 2,
            type: 'create_file',
            path: 'src/services/UserService.ts',
            description: 'Создать UserService',
            status: 'pending'
          },
          {
            id: 3,
            type: 'create_file',
            path: 'src/ui/Header.jsx',
            description: 'Создать Header',
            status: 'pending'
          }
        ]
      };

      (devPlanManager as any).assignReferencesToSteps(plan);

      // UI-компоненты должны получить referenceFiles
      expect(plan.steps[0].referenceFiles).toContain('.devil/references/brand-dna.md');
      expect(plan.steps[0].referenceFiles).toContain('.devil/references/design-system.md');
      
      expect(plan.steps[2].referenceFiles).toContain('.devil/references/brand-dna.md');
      expect(plan.steps[2].referenceFiles).toContain('.devil/references/design-system.md');

      // Не UI-компонент не должен получить referenceFiles
      expect(plan.steps[1].referenceFiles).toBeUndefined();
    });

    it('не должен дублировать referenceFiles, если они уже есть', () => {
      const plan: DevPlan = {
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'draft',
        totalSteps: 1,
        completedSteps: 0,
        steps: [
          {
            id: 1,
            type: 'create_file',
            path: 'src/components/Button.tsx',
            description: 'Создать Button',
            status: 'pending',
            referenceFiles: ['.devil/references/brand-dna.md']
          }
        ]
      };

      (devPlanManager as any).assignReferencesToSteps(plan);

      expect(plan.steps[0].referenceFiles).toHaveLength(2);
      expect(plan.steps[0].referenceFiles).toContain('.devil/references/brand-dna.md');
      expect(plan.steps[0].referenceFiles).toContain('.devil/references/design-system.md');
    });
  });

  describe('isUIComponent', () => {
    it('должен определять .tsx файлы как UI-компоненты', () => {
      expect((devPlanManager as any).isUIComponent('src/components/Button.tsx')).toBe(true);
      expect((devPlanManager as any).isUIComponent('src/ui/Header.tsx')).toBe(true);
    });

    it('должен определять .jsx файлы как UI-компоненты', () => {
      expect((devPlanManager as any).isUIComponent('src/components/Button.jsx')).toBe(true);
    });

    it('должен определять .vue файлы как UI-компоненты', () => {
      expect((devPlanManager as any).isUIComponent('src/components/Button.vue')).toBe(true);
    });

    it('должен определять файлы в папке components/ как UI-компоненты', () => {
      expect((devPlanManager as any).isUIComponent('src/components/utils/helper.ts')).toBe(true);
    });

    it('должен определять файлы в папке ui/ как UI-компоненты', () => {
      expect((devPlanManager as any).isUIComponent('src/ui/utils/helper.ts')).toBe(true);
    });

    it('не должен определять обычные .ts файлы как UI-компоненты', () => {
      expect((devPlanManager as any).isUIComponent('src/services/UserService.ts')).toBe(false);
      expect((devPlanManager as any).isUIComponent('src/utils/helpers.ts')).toBe(false);
    });
  });

  describe('addGlobalReference', () => {
    it('должен добавить reference-файл в globalReferences', async () => {
      const plan: DevPlan = {
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'draft',
        totalSteps: 0,
        completedSteps: 0,
        steps: [],
        globalReferences: []
      };

      (devPlanManager as any).currentPlan = plan;
      mockFileSystemService.writeFile.mockResolvedValue();

      await devPlanManager.addGlobalReference('docs/architecture.md');

      expect(plan.globalReferences).toContain('docs/architecture.md');
      expect(mockFileSystemService.writeFile).toHaveBeenCalled();
    });

    it('должен нормализовать пути (заменять \\ на /)', async () => {
      const plan: DevPlan = {
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'draft',
        totalSteps: 0,
        completedSteps: 0,
        steps: [],
        globalReferences: []
      };

      (devPlanManager as any).currentPlan = plan;
      mockFileSystemService.writeFile.mockResolvedValue();

      await devPlanManager.addGlobalReference('.devil\\references\\brand-dna.md');

      expect(plan.globalReferences).toContain('.devil/references/brand-dna.md');
    });

    it('должен выбросить ошибку при дубликате', async () => {
      const plan: DevPlan = {
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'draft',
        totalSteps: 0,
        completedSteps: 0,
        steps: [],
        globalReferences: ['docs/architecture.md']
      };

      (devPlanManager as any).currentPlan = plan;

      await expect(devPlanManager.addGlobalReference('docs/architecture.md')).rejects.toThrow(
        'Файл уже в списке'
      );
    });
  });

  describe('removeGlobalReference', () => {
    it('должен удалить reference-файл из globalReferences', async () => {
      const plan: DevPlan = {
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'draft',
        totalSteps: 0,
        completedSteps: 0,
        steps: [],
        globalReferences: ['docs/architecture.md', 'docs/guidelines.md']
      };

      (devPlanManager as any).currentPlan = plan;
      mockFileSystemService.writeFile.mockResolvedValue();

      await devPlanManager.removeGlobalReference('docs/architecture.md');

      expect(plan.globalReferences).not.toContain('docs/architecture.md');
      expect(plan.globalReferences).toContain('docs/guidelines.md');
    });

    it('должен выбросить ошибку, если файл не найден', async () => {
      const plan: DevPlan = {
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'draft',
        totalSteps: 0,
        completedSteps: 0,
        steps: [],
        globalReferences: []
      };

      (devPlanManager as any).currentPlan = plan;

      await expect(devPlanManager.removeGlobalReference('docs/architecture.md')).rejects.toThrow(
        'Файл не найден в списке'
      );
    });
  });
});
