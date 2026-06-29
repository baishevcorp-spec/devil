import * as vscode from 'vscode';
import * as path from 'path';
import { FileSystemService, FileTree } from './FileSystemService';
import { ProjectError } from '../utils/errors';
import { IProjectManager, ProjectInfo } from '../interfaces/IProjectManager';
import { logger } from '../utils/logger';

/**
 * Событие изменения файла.
 */
export interface FileChangeEvent {
  type: 'created' | 'changed' | 'deleted';
  path: string;
}

/**
 * ProjectManager — сервис управления текущим проектом.
 * 
 * Отвечает за:
 * - Хранение информации о текущем workspaceFolder
 * - Инициализацию служебной директории .devil/
 * - Сканирование структуры проекта
 * - Отслеживание изменений файлов через FileSystemWatcher
 * 
 * @example
 * ```typescript
 * const projectManager = new ProjectManager(fileSystemService);
 * await projectManager.initialize();
 * 
 * const project = projectManager.getCurrentProject();
 * console.log(project.name); // "my-project"
 * 
 * projectManager.onFileChanged((event) => {
 *   console.log(`File ${event.type}: ${event.path}`);
 * });
 * ```
 */
export class ProjectManager implements IProjectManager {
  private currentProject: ProjectInfo | null = null;
  private fileWatcher: vscode.FileSystemWatcher | null = null;
  private changeListeners: Array<(event: FileChangeEvent) => void> = [];
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly fileSystemService: FileSystemService) {}

  /**
   * Инициализирует ProjectManager: открывает текущий проект и создаёт .devil/.
   * Должен быть вызван при активации расширения.
   */
  async initialize(): Promise<void> {
    logger.info('Инициализация ProjectManager', 'ProjectManager');

    // Получаем текущий workspace folder
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    
    if (!workspaceFolder) {
      logger.warn('Проект не открыт. Ожидание команды devil.openProject', 'ProjectManager');
      return;
    }

    await this.setProject(workspaceFolder);
  }

  /**
   * Устанавливает текущий проект.
   * 
   * @param folder - Workspace folder из VS Code
   * @throws ProjectError если не удалось инициализировать проект
   */
  async setProject(folder: vscode.WorkspaceFolder): Promise<void> {
    logger.info(`Установка проекта: ${folder.uri.fsPath}`, 'ProjectManager');

    try {
      const projectPath = folder.uri.fsPath;
      const devilPath = path.join(projectPath, '.devil');

      // Создаём служебную директорию
      await this.fileSystemService.ensureDirectory(devilPath);

      // Сканируем структуру проекта
      const structure = await this.fileSystemService.scanDirectory(projectPath, {
        excludePatterns: ['.git', 'node_modules', 'out', 'backups', '.devil', 'coverage'],
        maxDepth: 10,
        includeContent: false
      });

      // Подсчитываем количество файлов
      const fileCount = this.countFiles(structure);

      this.currentProject = {
        name: folder.name,
        path: projectPath,
        devilPath,
        fileCount,
        structure
      };

      // Настраиваем FileSystemWatcher
      this.setupFileWatcher(projectPath);

      logger.info(`Проект установлен: ${folder.name} (${fileCount} файлов)`, 'ProjectManager');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Не удалось установить проект', error, 'ProjectManager');
      throw new ProjectError(
        `Failed to set project: ${message}`,
        'Не удалось открыть проект. Проверьте, что папка существует и доступна.'
      );
    }
  }

  /**
   * Возвращает информацию о текущем проекте.
   * 
   * @returns ProjectInfo или null, если проект не открыт
   */
  getCurrentProject(): ProjectInfo | null {
    return this.currentProject;
  }

  /**
   * Возвращает путь к служебной директории .devil/.
   * 
   * @returns Абсолютный путь или null, если проект не открыт
   */
  getDevilPath(): string | null {
    return this.currentProject?.devilPath || null;
  }

  /**
   * Возвращает структуру проекта.
   * 
   * @returns FileTree или null, если проект не открыт
   */
  getProjectStructure(): FileTree | null {
    return (this.currentProject?.structure as FileTree) || null;
  }

  /**
   * Регистрирует слушателя изменений файлов.
   * 
   * @param listener - Функция, вызываемая при изменении файла
   * @returns Disposable для отписки
   */
  onFileChanged(listener: (event: FileChangeEvent) => void): vscode.Disposable {
    this.changeListeners.push(listener);
    return new vscode.Disposable(() => {
      this.changeListeners = this.changeListeners.filter((l) => l !== listener);
    });
  }

  /**
   * Пересканирует структуру проекта.
   * Полезно после массовых изменений.
   */
  async refreshStructure(): Promise<void> {
    if (!this.currentProject) {
      logger.warn('Нельзя обновить структуру: проект не открыт', 'ProjectManager');
      return;
    }

    logger.info('Обновление структуры проекта', 'ProjectManager');

    const structure = await this.fileSystemService.scanDirectory(this.currentProject.path, {
      excludePatterns: ['.git', 'node_modules', 'out', 'backups', '.devil', 'coverage'],
      maxDepth: 10,
      includeContent: false
    });

    const fileCount = this.countFiles(structure);

    this.currentProject = {
      ...this.currentProject,
      structure,
      fileCount
    };

    logger.info(`Структура обновлена: ${fileCount} файлов`, 'ProjectManager');
  }

  /**
   * Настраивает FileSystemWatcher для отслеживания изменений.
   */
  private setupFileWatcher(projectPath: string): void {
    // Очищаем старый watcher, если есть
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }

    // Создаём новый watcher для всех файлов в проекте
    const pattern = new vscode.RelativePattern(projectPath, '**/*');
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    // Подписываемся на события
    const onDidCreate = this.fileWatcher.onDidCreate((uri) => {
      this.handleFileChange('created', uri.fsPath);
    });

    const onDidChange = this.fileWatcher.onDidChange((uri) => {
      this.handleFileChange('changed', uri.fsPath);
    });

    const onDidDelete = this.fileWatcher.onDidDelete((uri) => {
      this.handleFileChange('deleted', uri.fsPath);
    });

    this.disposables.push(this.fileWatcher, onDidCreate, onDidChange, onDidDelete);
  }

  /**
   * Обрабатывает событие изменения файла.
   */
  private handleFileChange(type: FileChangeEvent['type'], filePath: string): void {
    // Игнорируем изменения в .devil/
    if (filePath.includes('.devil')) {
      return;
    }

    logger.debug(`Файл ${type}: ${filePath}`, 'ProjectManager');

    const event: FileChangeEvent = { type, path: filePath };

    for (const listener of this.changeListeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error('Ошибка в слушателе onFileChanged', error, 'ProjectManager');
      }
    }
  }

  /**
   * Рекурсивно подсчитывает количество файлов в дереве.
   */
  private countFiles(tree: FileTree): number {
    if (tree.type === 'file') {
      return 1;
    }

    if (!tree.children) {
      return 0;
    }

    return tree.children.reduce((sum, child) => sum + this.countFiles(child), 0);
  }

  /**
   * Освобождает ресурсы. Вызывается при деактивации расширения.
   */
  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
    this.changeListeners = [];
    this.currentProject = null;
    logger.info('ProjectManager остановлен', 'ProjectManager');
  }
}
