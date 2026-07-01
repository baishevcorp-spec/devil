import * as path from 'path';
import { FileSystemService } from '../services/FileSystemService';
import { logger } from './logger';

/**
 * Элемент чек-листа
 */
export interface ChecklistItem {
  line: string;
  indent: string;
  checked: boolean;
  filePath: string;
  description: string;
  exists: boolean;
}

/**
 * Результат синхронизации чек-листа
 */
export interface SyncResult {
  totalItems: number;
  updatedStatuses: number;
  addedFiles: number;
  content: string;
  report: string;
}

/**
 * ChecklistSync — утилитарный класс для синхронизации чек-листа с реальной структурой проекта
 *
 * Сканирует проект, сравнивает с чек-листом, обновляет статусы и добавляет новые файлы.
 *
 * @example
 * ```typescript
 * const sync = new ChecklistSync(fileSystemService);
 * const result = await sync.sync(projectPath, checklistContent);
 * console.log(result.report); // "Обновлено 5 статусов, добавлено 3 новых файла"
 * ```
 */
export class ChecklistSync {
  constructor(private fileSystemService: FileSystemService) {}

  /**
   * Синхронизирует чек-лист с реальной структурой проекта.
   *
   * @param projectPath - Путь к корню проекта
   * @param checklistContent - Содержимое checklist.md
   * @returns Результат синхронизации с отчётом
   */
  async sync(projectPath: string, checklistContent: string): Promise<SyncResult> {
    logger.info('Начало синхронизации чек-листа', 'ChecklistSync');

    // 1. Парсим чек-лист
    const items = this.parseChecklist(checklistContent);
    logger.info(`Найдено ${items.length} элементов в чек-листе`, 'ChecklistSync');

    // 2. Проверяем существование файлов
    let updatedStatuses = 0;
    for (const item of items) {
      const fullPath = path.join(projectPath, item.filePath);
      item.exists = await this.fileSystemService.fileExists(fullPath);

      // Если файл существует, но не помечен — помечаем
      if (item.exists && !item.checked) {
        item.checked = true;
        updatedStatuses++;
      }
    }

    // 3. Сканируем реальную структуру проекта
    const projectFiles = await this.scanProjectFiles(projectPath);
    logger.info(`Найдено ${projectFiles.length} файлов в проекте`, 'ChecklistSync');

    // 4. Находим файлы, которых нет в чек-листе
    const checklistPaths = new Set(items.map(item => item.filePath));
    const newFiles = projectFiles.filter(f => !checklistPaths.has(f));
    logger.info(`Найдено ${newFiles.length} новых файлов`, 'ChecklistSync');

    // 5. Добавляем новые файлы в чек-лист
    const addedFiles = newFiles.length;
    if (newFiles.length > 0) {
      const newItems = newFiles.map(f => ({
        line: `- [x] \`${f}\` — новый файл`,
        indent: '',
        checked: true,
        filePath: f,
        description: 'новый файл',
        exists: true
      }));
      items.push(...newItems);
    }

    // 6. Формируем обновлённый чек-лист
    const updatedContent = this.rebuildChecklist(items);

    // 7. Формируем отчёт
    const report = this.generateReport(updatedStatuses, addedFiles);

    logger.info(`Синхронизация завершена: ${report}`, 'ChecklistSync');

    return {
      totalItems: items.length,
      updatedStatuses,
      addedFiles,
      content: updatedContent,
      report
    };
  }

  /**
   * Парсит чек-лист и извлекает элементы с чекбоксами.
   */
  private parseChecklist(content: string): ChecklistItem[] {
    const lines = content.split('\n');
    const items: ChecklistItem[] = [];

    for (const line of lines) {
      // Ищем строки с чекбоксами: - [ ] `path` — описание или - [x] `path` — описание
      const match = line.match(/^(\s*)- \[([ x])\] `([^`]+)`(?:\s*—\s*(.*))?$/);
      if (match) {
        const [, indent, checkbox, filePath, description] = match;
        items.push({
          line,
          indent,
          checked: checkbox === 'x',
          filePath: filePath.trim(),
          description: description?.trim() || '',
          exists: false
        });
      }
    }

    return items;
  }

  /**
   * Сканирует проект и возвращает список всех файлов (относительные пути).
   */
  private async scanProjectFiles(projectPath: string): Promise<string[]> {
    const tree = await this.fileSystemService.scanDirectory(projectPath, {
      excludePatterns: ['.git', 'node_modules', '.devil', 'out', 'backups']
    });

    const files: string[] = [];
    this.collectFiles(tree, projectPath, files);
    return files;
  }

  /**
   * Рекурсивно собирает все файлы из дерева.
   */
  private collectFiles(node: any, basePath: string, files: string[]): void {
    if (node.type === 'file') {
      const relativePath = path.relative(basePath, node.path).replace(/\\/g, '/');
      files.push(relativePath);
    } else if (node.children) {
      for (const child of node.children) {
        this.collectFiles(child, basePath, files);
      }
    }
  }

  /**
   * Перестраивает чек-лист из элементов.
   */
  private rebuildChecklist(items: ChecklistItem[]): string {
    return items.map(item => {
      const checkbox = item.checked ? '[x]' : '[ ]';
      const desc = item.description ? ` — ${item.description}` : '';
      return `${item.indent}- ${checkbox} \`${item.filePath}\`${desc}`;
    }).join('\n');
  }

  /**
   * Генерирует отчёт о синхронизации.
   */
  private generateReport(updatedStatuses: number, addedFiles: number): string {
    const parts: string[] = [];

    if (updatedStatuses > 0) {
      parts.push(`Обновлено ${updatedStatuses} статусов`);
    }

    if (addedFiles > 0) {
      parts.push(`добавлено ${addedFiles} новых файлов`);
    }

    if (parts.length === 0) {
      return 'Чек-лист актуален, изменений нет';
    }

    return parts.join(', ');
  }
}
