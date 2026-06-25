import * as fs from 'fs/promises';
import * as path from 'path';
import { ProjectError } from '../utils/errors';
import { logger } from '../utils/logger';

/**
 * Опции сканирования директории.
 */
export interface ScanOptions {
  /**
   * Паттерны исключения (glob-подобные).
   * По умолчанию: ['.git', 'node_modules', 'out', 'backups', '.devil']
   */
  excludePatterns?: string[];

  /**
   * Максимальная глубина рекурсии.
   * По умолчанию: 10
   */
  maxDepth?: number;

  /**
   * Включать ли содержимое файлов в результат.
   * По умолчанию: false
   */
  includeContent?: boolean;
}

/**
 * Узел дерева файлов.
 */
export interface FileTree {
  /**
   * Имя файла или директории.
   */
  name: string;

  /**
   * Относительный путь от корня проекта.
   */
  path: string;

  /**
   * Тип: файл или директория.
   */
  type: 'file' | 'directory';

  /**
   * Дочерние элементы (для директорий).
   */
  children?: FileTree[];

  /**
   * Содержимое файла (если includeContent = true).
   */
  content?: string;

  /**
   * Размер файла в байтах.
   */
  size?: number;
}

/**
 * FileSystemService — низкоуровневый сервис для работы с файловой системой.
 * 
 * Отвечает за:
 * - Чтение и запись файлов
 * - Рекурсивное сканирование директорий
 * - Исключение служебных папок (.git, node_modules, и т.д.)
 * - Построение дерева файлов
 * 
 * @example
 * ```typescript
 * const fsService = new FileSystemService();
 * const tree = await fsService.scanDirectory('/path/to/project', {
 *   excludePatterns: ['.git', 'node_modules'],
 *   maxDepth: 5
 * });
 * console.log(tree);
 * ```
 */
export class FileSystemService {
  /**
   * Паттерны исключения по умолчанию.
   */
  private static readonly DEFAULT_EXCLUDE_PATTERNS = [
    '.git',
    'node_modules',
    'out',
    'backups',
    '.devil',
    'coverage',
    '.vscode-test',
    '.DS_Store',
    'Thumbs.db'
  ];

  /**
   * Читает содержимое файла.
   * 
   * @param filePath - Абсолютный путь к файлу
   * @returns Содержимое файла в виде строки
   * @throws ProjectError если файл не существует или недоступен
   */
  async readFile(filePath: string): Promise<string> {
    try {
      logger.debug(`Чтение файла: ${filePath}`, 'FileSystemService');
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Не удалось прочитать файл: ${filePath}`, error, 'FileSystemService');
      throw new ProjectError(
        `Failed to read file: ${filePath}: ${message}`,
        `Не удалось прочитать файл: ${path.basename(filePath)}`
      );
    }
  }

  /**
   * Записывает содержимое в файл.
   * Создаёт директории, если их нет.
   * 
   * @param filePath - Абсолютный путь к файлу
   * @param content - Содержимое для записи
   * @throws ProjectError если не удалось записать файл
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    try {
      logger.debug(`Запись файла: ${filePath}`, 'FileSystemService');
      
      // Создаём директорию, если её нет
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      
      await fs.writeFile(filePath, content, 'utf-8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Не удалось записать файл: ${filePath}`, error, 'FileSystemService');
      throw new ProjectError(
        `Failed to write file: ${filePath}: ${message}`,
        `Не удалось записать файл: ${path.basename(filePath)}`
      );
    }
  }

  /**
   * Проверяет существование файла или директории.
   * 
   * @param filePath - Абсолютный путь
   * @returns true если существует
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Рекурсивно сканирует директорию и строит дерево файлов.
   * 
   * @param rootPath - Абсолютный путь к корневой директории
   * @param options - Опции сканирования
   * @returns Дерево файлов
   * @throws ProjectError если директория не существует
   */
  async scanDirectory(rootPath: string, options: ScanOptions = {}): Promise<FileTree> {
    const excludePatterns = options.excludePatterns || FileSystemService.DEFAULT_EXCLUDE_PATTERNS;
    const maxDepth = options.maxDepth || 10;
    const includeContent = options.includeContent || false;

    logger.info(`Сканирование директории: ${rootPath}`, 'FileSystemService');

    try {
      const tree = await this.buildTree(rootPath, rootPath, 0, maxDepth, excludePatterns, includeContent);
      logger.info(`Сканирование завершено`, 'FileSystemService');
      return tree;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Не удалось сканировать директорию: ${rootPath}`, error, 'FileSystemService');
      throw new ProjectError(
        `Failed to scan directory: ${rootPath}: ${message}`,
        'Не удалось просканировать проект. Проверьте, что папка существует и доступна.'
      );
    }
  }

  /**
   * Рекурсивно строит дерево файлов.
   */
  private async buildTree(
    currentPath: string,
    rootPath: string,
    currentDepth: number,
    maxDepth: number,
    excludePatterns: string[],
    includeContent: boolean
  ): Promise<FileTree> {
    const name = path.basename(currentPath);
    const relativePath = path.relative(rootPath, currentPath) || '.';

    // Проверяем, исключён ли этот путь
    if (this.shouldExclude(name, excludePatterns)) {
      return {
        name,
        path: relativePath,
        type: 'directory',
        children: []
      };
    }

    const stats = await fs.stat(currentPath);

    if (stats.isFile()) {
      const node: FileTree = {
        name,
        path: relativePath,
        type: 'file',
        size: stats.size
      };

      if (includeContent) {
        try {
          node.content = await fs.readFile(currentPath, 'utf-8');
        } catch {
          // Если не удалось прочитать (бинарный файл), оставляем content пустым
          node.content = '';
        }
      }

      return node;
    }

    if (stats.isDirectory()) {
      if (currentDepth >= maxDepth) {
        return {
          name,
          path: relativePath,
          type: 'directory',
          children: []
        };
      }

      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      const children: FileTree[] = [];

      for (const entry of entries) {
        const entryPath = path.join(currentPath, entry.name);
        const childTree = await this.buildTree(
          entryPath,
          rootPath,
          currentDepth + 1,
          maxDepth,
          excludePatterns,
          includeContent
        );
        
        // Добавляем только если не исключён
        if (!this.shouldExclude(entry.name, excludePatterns)) {
          children.push(childTree);
        }
      }

      return {
        name,
        path: relativePath,
        type: 'directory',
        children
      };
    }

    // Если это не файл и не директория (например, symlink), возвращаем пустой узел
    return {
      name,
      path: relativePath,
      type: 'file'
    };
  }

  /**
   * Проверяет, нужно ли исключить файл/директорию по паттернам.
   */
  private shouldExclude(name: string, patterns: string[]): boolean {
    return patterns.some((pattern) => {
      // Простая проверка: если паттерн совпадает с именем или содержится в нём
      if (pattern === name) return true;
      if (name.startsWith(pattern)) return true;
      return false;
    });
  }

  /**
   * Создаёт директорию, если её нет.
   * 
   * @param dirPath - Абсолютный путь к директории
   */
  async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Не удалось создать директорию: ${dirPath}`, error, 'FileSystemService');
      throw new ProjectError(
        `Failed to create directory: ${dirPath}: ${message}`,
        'Не удалось создать служебную директорию.'
      );
    }
  }
}
