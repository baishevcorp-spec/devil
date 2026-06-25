import { ProjectManager } from '../../src/services/ProjectManager';
import { FileSystemService } from '../../src/services/FileSystemService';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';


describe('ProjectManager', () => {
  let projectManager: ProjectManager;
  let fsService: FileSystemService;
  let testDir: string;

  beforeEach(async () => {
    fsService = new FileSystemService();
    projectManager = new ProjectManager(fsService);
    
    // Создаём временную директорию для тестов
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devil-project-'));
    
    // Создаём тестовую структуру проекта
    await fs.mkdir(path.join(testDir, 'src'));
    await fs.writeFile(path.join(testDir, 'src', 'index.ts'), 'console.log("hello")', 'utf-8');
    await fs.writeFile(path.join(testDir, 'package.json'), '{"name": "test"}', 'utf-8');
  });

  afterEach(async () => {
    projectManager.dispose();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('setProject', () => {
    it('устанавливает текущий проект', async () => {
      const mockFolder = {
        uri: { fsPath: testDir },
        name: 'test-project',
        index: 0
      } as vscode.WorkspaceFolder;

      await projectManager.setProject(mockFolder);

      const project = projectManager.getCurrentProject();
      expect(project).not.toBeNull();
      expect(project!.name).toBe('test-project');
      expect(project!.path).toBe(testDir);
      expect(project!.devilPath).toBe(path.join(testDir, '.devil'));
    });

    it('создаёт директорию .devil/', async () => {
      const mockFolder = {
        uri: { fsPath: testDir },
        name: 'test-project',
        index: 0
      } as vscode.WorkspaceFolder;

      await projectManager.setProject(mockFolder);

      const devilPath = path.join(testDir, '.devil');
      const exists = await fsService.fileExists(devilPath);
      expect(exists).toBe(true);
    });

    it('сканирует структуру проекта', async () => {
      const mockFolder = {
        uri: { fsPath: testDir },
        name: 'test-project',
        index: 0
      } as vscode.WorkspaceFolder;

      await projectManager.setProject(mockFolder);

      const project = projectManager.getCurrentProject();
      expect(project!.structure).toBeDefined();
      expect(project!.structure.type).toBe('directory');
      expect(project!.fileCount).toBeGreaterThan(0);
    });
  });

  describe('getCurrentProject', () => {
    it('возвращает null, если проект не установлен', () => {
      const project = projectManager.getCurrentProject();
      expect(project).toBeNull();
    });

    it('возвращает ProjectInfo после установки', async () => {
      const mockFolder = {
        uri: { fsPath: testDir },
        name: 'test-project',
        index: 0
      } as vscode.WorkspaceFolder;

      await projectManager.setProject(mockFolder);

      const project = projectManager.getCurrentProject();
      expect(project).not.toBeNull();
      expect(project!.name).toBe('test-project');
    });
  });

  describe('getDevilPath', () => {
    it('возвращает null, если проект не установлен', () => {
      const devilPath = projectManager.getDevilPath();
      expect(devilPath).toBeNull();
    });

    it('возвращает путь к .devil/ после установки', async () => {
      const mockFolder = {
        uri: { fsPath: testDir },
        name: 'test-project',
        index: 0
      } as vscode.WorkspaceFolder;

      await projectManager.setProject(mockFolder);

      const devilPath = projectManager.getDevilPath();
      expect(devilPath).toBe(path.join(testDir, '.devil'));
    });
  });

  describe('refreshStructure', () => {
    it('обновляет структуру проекта', async () => {
      const mockFolder = {
        uri: { fsPath: testDir },
        name: 'test-project',
        index: 0
      } as vscode.WorkspaceFolder;

      await projectManager.setProject(mockFolder);

      // Добавляем новый файл
      await fs.writeFile(path.join(testDir, 'new-file.txt'), 'new content', 'utf-8');

      const oldFileCount = projectManager.getCurrentProject()!.fileCount;

      await projectManager.refreshStructure();

      const newFileCount = projectManager.getCurrentProject()!.fileCount;
      expect(newFileCount).toBeGreaterThan(oldFileCount);
    });

    it('не бросает ошибку, если проект не установлен', async () => {
      await expect(projectManager.refreshStructure()).resolves.not.toThrow();
    });
  });
});
