import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger';
import { ProjectError } from '../utils/errors';

export interface ScanOptions {
  excludePatterns?: string[];
  maxDepth?: number;
  includeContent?: boolean;
}

export interface FileTree {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTree[];
  content?: string;
}

export class FileSystemService {
  static DEFAULT_EXCLUDE_PATTERNS = [
    '**/node_modules/**',
    '**/.git/**',
    '**/out/**',
    '**/dist/**',
    '**/backups/**',
    '**/.devil/**',
    '**/*.log',
    '**/*.tmp'
  ];

  async readFile(filePath: string): Promise<string> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Не удалось прочитать файл: ' + filePath, error, 'FileSystemService');
      throw new ProjectError(
        'Failed to read file: ' + filePath + ': ' + message,
        'Не удалось прочитать файл. Проверьте, что файл существует и доступен.'
      );
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    try {
      const dir = path.dirname(filePath);
      await this.ensureDirectory(dir);
      await fs.writeFile(filePath, content, 'utf-8');
      logger.debug('Файл записан: ' + filePath, undefined, 'FileSystemService');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Не удалось записать файл: ' + filePath, error, 'FileSystemService');
      throw new ProjectError(
        'Failed to write file: ' + filePath + ': ' + message,
        'Не удалось записать файл. Проверьте права доступа.'
      );
    }
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async scanDirectory(rootPath: string, options: ScanOptions = {}): Promise<FileTree> {
    const excludePatterns = options.excludePatterns || FileSystemService.DEFAULT_EXCLUDE_PATTERNS;
    const maxDepth = options.maxDepth || 10;
    const includeContent = options.includeContent || false;

    logger.info('Сканирование директории: ' + rootPath, undefined, 'FileSystemService');

    try {
      const tree = await this.buildTree(rootPath, rootPath, 0, maxDepth, excludePatterns, includeContent);
      logger.info('Сканирование завершено', undefined, 'FileSystemService');
      return tree;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Не удалось сканировать директорию: ' + rootPath, error, 'FileSystemService');
      throw new ProjectError(
        'Failed to scan directory: ' + rootPath + ': ' + message,
        'Не удалось просканировать проект. Проверьте, что папка существует и доступна.'
      );
    }
  }

  /**
   * Рекурсивно собирает все пути файлов из FileTree в плоский массив.
   * Использует относительные пути из FileTree.path и склеивает с rootPath.
   * @param tree Корень дерева
   * @param rootPath Абсолютный путь к корню проекта
   * @returns Массив абсолютных путей к файлам
   */
  collectFiles(tree: FileTree, rootPath?: string): string[] {
    const files: string[] = [];

    const traverse = (node: FileTree): void => {
      if (node.type === 'file') {
        const absPath = rootPath
          ? path.join(rootPath, node.path)
          : node.path;
        files.push(absPath);
      }
      if (node.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    traverse(tree);
    return files;
  }

  async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'EEXIST') {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Не удалось создать директорию: ' + dirPath, error, 'FileSystemService');
        throw new ProjectError(
          'Failed to create directory: ' + dirPath + ': ' + message,
          'Не удалось создать директорию. Проверьте права доступа.'
        );
      }
    }
  }

  private async buildTree(
    currentPath: string,
    rootPath: string,
    depth: number,
    maxDepth: number,
    excludePatterns: string[],
    includeContent: boolean
  ): Promise<FileTree> {
    const stats = await fs.stat(currentPath);
    const name = path.basename(currentPath);
    const relativePath = path.relative(rootPath, currentPath);

    const node: FileTree = {
      name,
      path: relativePath || '.',
      type: stats.isDirectory() ? 'directory' : 'file'
    };

    if (stats.isFile() && includeContent) {
      try {
        node.content = await fs.readFile(currentPath, 'utf-8');
      } catch {
        // Игнорируем ошибки чтения содержимого
      }
    }

    if (stats.isDirectory()) {
      node.children = [];

      if (depth < maxDepth) {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });

        for (const entry of entries) {
          const entryPath = path.join(currentPath, entry.name);
          const relativeEntryPath = path.relative(rootPath, entryPath);

          // Проверяем исключения: по имени И по regex-паттерну
          const shouldExcludeByName = excludePatterns.some(pattern => {
            const nameMatch = pattern.match(/\*\*\/([^*]+)\/\*\*/) || pattern.match(/([^*]+)/);
            const excludeName = nameMatch ? nameMatch[1] : pattern;
            return entry.name === excludeName;
          });

          const shouldExcludeByRegex = excludePatterns.some(pattern => {
            const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
            return regex.test(relativeEntryPath);
          });

          if (!shouldExcludeByName && !shouldExcludeByRegex) {
            const childNode = await this.buildTree(
              entryPath,
              rootPath,
              depth + 1,
              maxDepth,
              excludePatterns,
              includeContent
            );
            node.children.push(childNode);
          }
        }
      }
    }

    return node;
  }
}
