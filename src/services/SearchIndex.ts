import * as fs from 'fs';
import * as path from 'path';
import * as FlexSearch from 'flexsearch';
import { FileSystemService } from './FileSystemService';
import { ISearchIndex, SearchResult, SearchOptions } from '../interfaces/ISearchIndex';
import { logger } from '../utils/logger';

interface IndexDocument {
  id: string;
  filePath: string;
  line: number;
  column: number;
  content: string;
}

/**
 * SearchIndex — полнотекстовый поиск по проекту с использованием flexsearch.
 *
 * Отвечает за:
 * - Построение индекса по содержимому файлов
 * - Инкрементальное обновление через FileSystemWatcher
 * - Быстрый поиск с подсветкой совпадений
 *
 * Индекс хранится в памяти (не сохраняется на диск).
 */
export class SearchIndex implements ISearchIndex {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private index: any = null; // flexsearch имеет плохие типы, используем any
  private projectPath: string = '';
  private fileSystemService: FileSystemService;
  private indexedFiles: Map<string, string[]> = new Map();
  private fileContents: Map<string, string> = new Map();

  constructor(fileSystemService: FileSystemService) {
    this.fileSystemService = fileSystemService;
    logger.info('SearchIndex создан', 'SearchIndex');
  }

  async initialize(projectPath: string): Promise<void> {
    this.projectPath = projectPath;

    this.index = new FlexSearch.Document({
      document: {
        id: 'id',
        index: ['content', 'filePath'],
        store: ['filePath', 'line', 'column', 'content']
      },
      tokenize: 'forward',
      cache: 100,
      resolution: 9,
      context: {
        resolution: 9,
        depth: 2,
        bidirectional: true
      }
    });

    logger.info('SearchIndex инициализирован для проекта: ' + projectPath, 'SearchIndex');
  }

  async buildIndex(): Promise<void> {
    if (!this.index) {
      throw new Error('SearchIndex не инициализирован');
    }

    logger.info('Начало построения индекса для проекта: ' + this.projectPath, 'SearchIndex');
    const startTime = Date.now();

    const files = await this.scanProjectFiles();
    logger.info('Найдено файлов для индексации: ' + files.length, 'SearchIndex');

    let indexedCount = 0;
    for (const filePath of files) {
      try {
        await this.addToIndex(filePath);
        indexedCount++;

        if (indexedCount % 100 === 0) {
          logger.info('Проиндексировано файлов: ' + indexedCount + '/' + files.length, 'SearchIndex');
        }
      } catch (error) {
        logger.warn('Не удалось проиндексировать файл: ' + filePath, 'SearchIndex');
      }
    }

    const duration = Date.now() - startTime;
    logger.info('Индекс построен за ' + duration + 'мс (файлов: ' + indexedCount + ')', 'SearchIndex');
  }

  async addToIndex(filePath: string): Promise<void> {
    if (!this.index) {
      throw new Error('SearchIndex не инициализирован');
    }

    try {
      const content = await this.fileSystemService.readFile(filePath);
      const relativePath = path.relative(this.projectPath, filePath);

      this.fileContents.set(relativePath, content);

      const lines = content.split('\n');
      const docIds: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().length === 0) continue;

        const docId = `${relativePath}:${i + 1}`;
        const doc: IndexDocument = {
          id: docId,
          filePath: relativePath,
          line: i + 1,
          column: 1,
          content: line
        };

        this.index.add(doc);
        docIds.push(docId);
      }

      this.indexedFiles.set(relativePath, docIds);
      logger.debug('Файл добавлен в индекс: ' + relativePath + ' (' + docIds.length + ' строк)', 'SearchIndex');
    } catch (error) {
      logger.error('Ошибка добавления файла в индекс: ' + filePath, error, 'SearchIndex');
    }
  }

  async updateInIndex(filePath: string): Promise<void> {
    await this.removeFromIndex(filePath);
    await this.addToIndex(filePath);
  }

  async removeFromIndex(filePath: string): Promise<void> {
    if (!this.index) return;

    const relativePath = path.relative(this.projectPath, filePath);
    const docIds = this.indexedFiles.get(relativePath);

    if (docIds) {
      for (const docId of docIds) {
        this.index.remove(docId);
      }
      this.indexedFiles.delete(relativePath);
      this.fileContents.delete(relativePath);
      logger.debug('Файл удалён из индекса: ' + relativePath, 'SearchIndex');
    }
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    if (!this.index) {
      throw new Error('SearchIndex не инициализирован');
    }

    const limit = options.limit || 50;
    const caseSensitive = options.caseSensitive || false;

    const results = this.index.search(query, {
      limit: limit * 2,
      enrich: true,
      resolve: 'document'
    });

    const searchResults: SearchResult[] = [];
    const seen = new Set<string>();

    for (const result of results) {
      if (!result.result) continue;

      for (const item of result.result) {
        const doc = item.doc as IndexDocument;

        const key = `${doc.filePath}:${doc.line}`;
        if (seen.has(key)) continue;
        seen.add(key);

        if (options.filePattern && !doc.filePath.includes(options.filePattern)) {
          continue;
        }

        const highlights = this.createHighlights(doc.content, query, caseSensitive);

        searchResults.push({
          filePath: doc.filePath,
          line: doc.line,
          column: doc.column,
          content: doc.content,
          score: item.score || 1,
          highlights
        });

        if (searchResults.length >= limit) break;
      }
      if (searchResults.length >= limit) break;
    }

    searchResults.sort((a, b) => b.score - a.score);

    logger.info('Поиск "' + query + '" нашёл ' + searchResults.length + ' результатов', 'SearchIndex');
    return searchResults;
  }

  async getStats(): Promise<{
    totalFiles: number;
    totalDocuments: number;
    indexSize: number;
  }> {
    const totalFiles = this.indexedFiles.size;
    let totalDocuments = 0;
    for (const docIds of this.indexedFiles.values()) {
      totalDocuments += docIds.length;
    }

    const indexSize = totalDocuments * 200;

    return {
      totalFiles,
      totalDocuments,
      indexSize
    };
  }

  async clear(): Promise<void> {
    if (this.index) {
      this.index = null;
    }
    this.indexedFiles.clear();
    this.fileContents.clear();
    logger.info('Индекс очищен', 'SearchIndex');
  }

  private async scanProjectFiles(): Promise<string[]> {
    const files: string[] = [];
    const excludePatterns = [
      'node_modules',
      '.git',
      'out',
      'dist',
      'backups',
      '.devil',
      '*.min.js',
      '*.min.css'
    ];

    const scanDir = async (dir: string): Promise<void> => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        // Проверяем, находится ли текущая директория или файл в списке исключений
        const isExcluded = excludePatterns.some(pattern => {
          if (pattern.startsWith('*')) {
            // Паттерн для файлов (*.min.js)
            return entry.name.endsWith(pattern.substring(1));
          } else {
            // Паттерн для директорий (node_modules, .git)
            return entry.name === pattern;
          }
        });
        
        if (isExcluded) {
          continue;
        }

        if (entry.isDirectory()) {
          await scanDir(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          const textExtensions = [
            '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.cpp', '.c', '.h',
            '.md', '.json', '.yaml', '.yml', '.xml', '.html', '.css', '.scss',
            '.sql', '.sh', '.bash', '.txt', '.log'
          ];
          
          if (textExtensions.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    };

    await scanDir(this.projectPath);
    return files;
  }

  private createHighlights(content: string, query: string, caseSensitive: boolean): string[] {
    const highlights: string[] = [];
    const flags = caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);

    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const start = Math.max(0, match.index - 30);
      const end = Math.min(content.length, match.index + match[0].length + 30);
      highlights.push(content.substring(start, end));
    }

    return highlights;
  }
}
