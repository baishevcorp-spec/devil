import { ProjectManager, ProjectInfo } from './ProjectManager';
import * as path from 'path';
import { FileSystemService, FileTree } from './FileSystemService';
import { IMemoryStore } from '../interfaces/IMemoryStore';
import { logger } from '../utils/logger';

/**
 * Опции построения контекста.
 */
export interface ContextOptions {
  /**
   * Включать ли структуру проекта в промпт.
   * @default true
   */
  includeProjectStructure?: boolean;

  /**
   * Включать ли Roadmap в промпт.
   * @default true
   */
  includeRoadmap?: boolean;

  /**
   * Включать ли чек-лист в промпт.
   * @default true
   */
  includeChecklist?: boolean;

  /**
   * Включать ли данные из графовой памяти.
   * @default true
   */
  includeMemoryGraph?: boolean;

  /**
   * Включать ли профиль пользователя.
   * @default true
   */
  includeUserProfile?: boolean;

  /**
   * Максимальная длина контекста в символах.
   * @default 10000
   */
  maxContextLength?: number;
}

/**
 * Результат построения контекста.
 */
export interface ContextResult {
  /**
   * Системный промпт для LLM.
   */
  systemPrompt: string;

  /**
   * Метаданные контекста (для отладки).
   */
  metadata: {
    projectStructureIncluded: boolean;
    roadmapIncluded: boolean;
    checklistIncluded: boolean;
    memoryGraphIncluded: boolean;
    userProfileIncluded: boolean;
    totalLength: number;
    truncated: boolean;
  };
}

/**
 * ContextBuilder — сервис для построения системного промпта.
 * 
 * Отвечает за:
 * - Сбор данных из различных источников (проект, память, профиль)
 * - Формирование структурированного системного промпта
 * - Ограничение длины контекста (чтобы не превысить лимит токенов)
 * 
 * @example
 * ```typescript
 * const contextBuilder = new ContextBuilder(projectManager, fileSystemService, memoryStore);
 * const context = await contextBuilder.buildContext('Объясни этот код', {
 *   includeProjectStructure: true,
 *   includeMemoryGraph: true
 * });
 * 
 * console.log(context.systemPrompt);
 * ```
 */
export class ContextBuilder {
  constructor(
    private readonly projectManager: ProjectManager,
    private readonly fileSystemService: FileSystemService,
    private readonly memoryStore: IMemoryStore | null = null
  ) {
    logger.info('ContextBuilder инициализирован', 'ContextBuilder');
  }

  /**
   * Строит системный промпт на основе запроса пользователя и опций.
   * 
   * @param userQuery - Запрос пользователя
   * @param options - Опции построения контекста
   * @returns Системный промпт и метаданные
   */
  async buildContext(userQuery: string, options: ContextOptions = {}): Promise<ContextResult> {
    const project = this.projectManager.getCurrentProject();
    
    if (!project) {
      logger.warn('Проект не открыт, контекст будет минимальным', 'ContextBuilder');
      return {
        systemPrompt: this.buildMinimalContext(userQuery),
        metadata: {
          projectStructureIncluded: false,
          roadmapIncluded: false,
          checklistIncluded: false,
          memoryGraphIncluded: false,
          userProfileIncluded: false,
          totalLength: 0,
          truncated: false
        }
      };
    }

    logger.info('Построение контекста для запроса: ' + userQuery.substring(0, 50) + '...', 'ContextBuilder');

    const parts: string[] = [];
    const metadata: ContextResult['metadata'] = {
      projectStructureIncluded: false,
      roadmapIncluded: false,
      checklistIncluded: false,
      memoryGraphIncluded: false,
      userProfileIncluded: false,
      totalLength: 0,
      truncated: false
    };

    // 1. Базовая информация о проекте
    parts.push(this.buildProjectInfo(project));

    // 2. Структура проекта
    if (options.includeProjectStructure !== false) {
      const structure = this.buildProjectStructure(project.structure);
      if (structure) {
        parts.push(structure);
        metadata.projectStructureIncluded = true;
      }
    }

    // 3. Roadmap
    if (options.includeRoadmap !== false) {
      const roadmap = await this.buildRoadmap(project.devilPath);
      if (roadmap) {
        parts.push(roadmap);
        metadata.roadmapIncluded = true;
      }
    }

    // 4. Чек-лист
    if (options.includeChecklist !== false) {
      const checklist = await this.buildChecklist(project.devilPath);
      if (checklist) {
        parts.push(checklist);
        metadata.checklistIncluded = true;
      }
    }

    // 5. Графовая память
    if (options.includeMemoryGraph !== false && this.memoryStore) {
      const memory = await this.buildMemoryContext();
      if (memory) {
        parts.push(memory);
        metadata.memoryGraphIncluded = true;
      }
    }

    // 6. Профиль пользователя (заглушка, будет реализован в BCK-20)
    if (options.includeUserProfile !== false) {
      const userProfile = this.buildUserProfileContext();
      if (userProfile) {
        parts.push(userProfile);
        metadata.userProfileIncluded = true;
      }
    }

    // 7. Запрос пользователя
    parts.push('\n## Запрос пользователя\n\n' + userQuery);

    // Объединяем все части
    let systemPrompt = parts.join('\n\n');

    // Ограничиваем длину, если нужно
    const maxLength = options.maxContextLength || 10000;
    if (systemPrompt.length > maxLength) {
      systemPrompt = systemPrompt.substring(0, maxLength) + '\n\n[Контекст обрезан из-за ограничения длины]';
      metadata.truncated = true;
    }

    metadata.totalLength = systemPrompt.length;

    logger.info('Контекст построен (длина: ' + systemPrompt.length + ' символов)', 'ContextBuilder');

    return { systemPrompt, metadata };
  }

  /**
   * Строит минимальный контекст, если проект не открыт.
   */
  private buildMinimalContext(userQuery: string): string {
    return '# Devil AI Assistant\n\n' +
      'Ты — Devil, интеллектуальный ассистент для разработчика. Отвечай на русском языке, кратко и по делу. Используй Markdown для форматирования.\n\n' +
      '## Запрос пользователя\n\n' +
      userQuery;
  }

  /**
   * Строит базовую информацию о проекте.
   */
  private buildProjectInfo(project: ProjectInfo): string {
    return '# Информация о проекте\n\n' +
      '- **Название:** ' + project.name + '\n' +
      '- **Путь:** `' + project.path + '`\n' +
      '- **Количество файлов:** ' + project.fileCount;
  }

  /**
   * Строит структуру проекта в виде дерева.
   */
  private buildProjectStructure(tree: FileTree): string | null {
    if (!tree.children || tree.children.length === 0) {
      return null;
    }

    const lines: string[] = [];
    lines.push('# Структура проекта');
    lines.push('');
    lines.push('```');
    this.formatTree(tree, lines, 0);
    lines.push('```');

    return lines.join('\n');
  }

  /**
   * Рекурсивно форматирует дерево файлов.
   */
  private formatTree(node: FileTree, lines: string[], depth: number): void {
    if (depth > 3) {
      return;
    }

    const indent = '  '.repeat(depth);
    const icon = node.type === 'directory' ? '📁' : '📄';
    lines.push(indent + icon + ' ' + node.name);

    if (node.children) {
      const childrenToShow = node.children.slice(0, 10);
      for (const child of childrenToShow) {
        this.formatTree(child, lines, depth + 1);
      }

      if (node.children.length > 10) {
        lines.push(indent + '  ... и ещё ' + (node.children.length - 10) + ' файлов');
      }
    }
  }

  /**
   * Строит контекст из Roadmap.
   */
  private async buildRoadmap(devilPath: string): Promise<string | null> {
    try {
      const roadmapPath = path.join(devilPath, 'roadmap.md');
      const exists = await this.fileSystemService.fileExists(roadmapPath);
      
      if (!exists) {
        return null;
      }

      const content = await this.fileSystemService.readFile(roadmapPath);
      
      const maxLength = 2000;
      const truncatedContent = content.length > maxLength 
        ? content.substring(0, maxLength) + '\n\n[Roadmap обрезан]'
        : content;

      return '# Roadmap проекта\n\n' + truncatedContent;
    } catch (error) {
      logger.warn('Не удалось прочитать Roadmap: ' + (error instanceof Error ? error.message : String(error)), 'ContextBuilder');
      return null;
    }
  }

  /**
   * Строит контекст из чек-листа.
   */
  private async buildChecklist(devilPath: string): Promise<string | null> {
    try {
      const checklistPath = path.join(devilPath, 'checklist.md');
      const exists = await this.fileSystemService.fileExists(checklistPath);
      
      if (!exists) {
        return null;
      }

      const content = await this.fileSystemService.readFile(checklistPath);
      
      const maxLength = 1500;
      const truncatedContent = content.length > maxLength 
        ? content.substring(0, maxLength) + '\n\n[Чек-лист обрезан]'
        : content;

      return '# Чек-лист задач\n\n' + truncatedContent;
    } catch (error) {
      logger.warn('Не удалось прочитать чек-лист: ' + (error instanceof Error ? error.message : String(error)), 'ContextBuilder');
      return null;
    }
  }

  /**
   * Строит контекст из графовой памяти.
   */
  private async buildMemoryContext(): Promise<string | null> {
    if (!this.memoryStore) {
      return null;
    }

    try {
      const nodes = await this.memoryStore.findNodes({ limit: 20 });
      
      if (nodes.length === 0) {
        return null;
      }

      const lines: string[] = [];
      lines.push('# Графовая память проекта');
      lines.push('');
      
      const files = nodes.filter(n => n.type === 'file');
      const classes = nodes.filter(n => n.type === 'class');
      const functions = nodes.filter(n => n.type === 'function');

      if (files.length > 0) {
        lines.push('## Файлы:');
        files.slice(0, 10).forEach(f => {
          lines.push('- ' + f.name + ' (`' + (f.path || '') + '`)');
        });
      }

      if (classes.length > 0) {
        lines.push('');
        lines.push('## Классы:');
        classes.slice(0, 10).forEach(c => lines.push('- ' + c.name));
      }

      if (functions.length > 0) {
        lines.push('');
        lines.push('## Функции:');
        functions.slice(0, 10).forEach(f => lines.push('- ' + f.name));
      }

      return lines.join('\n');
    } catch (error) {
      logger.warn('Не удалось получить данные из графовой памяти: ' + (error instanceof Error ? error.message : String(error)), 'ContextBuilder');
      return null;
    }
  }

  /**
   * Строит контекст из профиля пользователя.
   * Заглушка — будет реализован в BCK-20.
   */
  private buildUserProfileContext(): string | null {
    // Временно возвращаем null, пока не реализован UserProfileManager
    return null;
  }
}
