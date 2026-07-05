import * as fs from 'fs';
import * as path from 'path';
import * as FlexSearch from 'flexsearch';
import { FileSystemService } from './FileSystemService';
import { ISearchIndex, SearchResult, SearchOptions } from '../interfaces/ISearchIndex';
import { logger } from '../utils/logger';
import { EmbeddingService } from './EmbeddingService';
import { MemoryStore } from './MemoryStore';
import { GraphNode } from '../interfaces/IMemoryStore';

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
 * - Семантический поиск по памяти через embeddings (BCK-29)
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
  private embeddingService: EmbeddingService | null = null;
  private memoryStore: MemoryStore | null = null;

  constructor(fileSystemService: FileSystemService) {
    this.fileSystemService = fileSystemService;
    logger.info('SearchIndex создан', 'SearchIndex');
  }

  /**
   * Устанавливает зависимости для семантического поиска (BCK-29)
   */
  setSemanticDependencies(embeddingService: EmbeddingService, memoryStore: MemoryStore): void {
    this.embeddingService = embeddingService;
    this.memoryStore = memoryStore;
    logger.info('Semantic search dependencies установлены', 'SearchIndex');
  }

  async initialize(projectPath: string): Promise<void> {
    this.projectPath = projectPath;

    this.index = new FlexSearch.Document({
      document: {
        id: 'id',
        index: ['content', 'filePath'],
        store: ['filePath', 'line', 'column', 'content'],
      },
      tokenize: 'forward',
      cache: 100,
      resolution: 9,
      context: {
        resolution: 9,
        depth: 2,
        bidirectional: true,
      },
    });

    logger.info('SearchIndex инициализирован для проекта: ' + projectPath, 'SearchIndex');
  }

  /**
   * Строит индекс из уже просканированного дерева файлов (оптимизация).
   * Избегает двойного сканирования ФС.
   */
  async buildIndexFromTree(files: string[]): Promise<void> {
    if (!this.index) {
      throw new Error('SearchIndex не инициализирован');
    }

    logger.info('Начало построения индекса из дерева: ' + files.length + ' файлов', 'SearchIndex');
    const startTime = Date.now();

    // Параллельная индексация с batch размером 50 файлов (аудит 2026-06-29)
    const batchSize = 50;
    let indexedCount = 0;

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      const results = await Promise.allSettled(batch.map((filePath) => this.addToIndex(filePath)));

      for (const result of results) {
        if (result.status === 'fulfilled') {
          indexedCount++;
        } else {
          logger.warn('Не удалось проиндексировать файл', 'SearchIndex');
        }
      }

      if (indexedCount % 100 === 0 || i + batchSize >= files.length) {
        logger.info('Проиндексировано файлов: ' + indexedCount + '/' + files.length, 'SearchIndex');
      }
    }

    const duration = Date.now() - startTime;
    logger.info(
      'Индекс построен за ' + duration + 'мс (файлов: ' + indexedCount + ')',
      'SearchIndex'
    );
  }

  async buildIndex(): Promise<void> {
    if (!this.index) {
      throw new Error('SearchIndex не инициализирован');
    }

    logger.info('Начало построения индекса для проекта: ' + this.projectPath, 'SearchIndex');
    const startTime = Date.now();

    const files = await this.scanProjectFiles();
    logger.info('Найдено файлов для индексации: ' + files.length, 'SearchIndex');

    // Параллельная индексация с batch размером 50 файлов (аудит 2026-06-29)
    const batchSize = 50;
    let indexedCount = 0;

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      const results = await Promise.allSettled(batch.map((filePath) => this.addToIndex(filePath)));

      // Считаем успешные индексации
      for (const result of results) {
        if (result.status === 'fulfilled') {
          indexedCount++;
        } else {
          logger.warn('Не удалось проиндексировать файл: ' + result.reason, 'SearchIndex');
        }
      }

      if (indexedCount % 100 === 0 || i + batchSize >= files.length) {
        logger.info('Проиндексировано файлов: ' + indexedCount + '/' + files.length, 'SearchIndex');
      }
    }

    const duration = Date.now() - startTime;
    logger.info(
      'Индекс построен за ' + duration + 'мс (файлов: ' + indexedCount + ')',
      'SearchIndex'
    );
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
          content: line,
        };

        this.index.add(doc);
        docIds.push(docId);
      }

      this.indexedFiles.set(relativePath, docIds);

      // Логируем каждые 100 файлов, а не каждую строку (аудит 2026-06-29)
      if (this.fileContents.size % 100 === 0) {
        logger.debug('Файлов проиндексировано: ' + this.fileContents.size, 'SearchIndex');
      }
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

  isInitialized(): boolean {
    return this.index !== null;
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
      resolve: 'document',
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
          highlights,
        });

        if (searchResults.length >= limit) break;
      }
      if (searchResults.length >= limit) break;
    }

    searchResults.sort((a, b) => b.score - a.score);

    logger.info(
      'Поиск "' + query + '" нашёл ' + searchResults.length + ' результатов',
      'SearchIndex'
    );
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
      indexSize,
    };
  }

  async clear(): Promise<void> {
    // Пересоздаём индекс вместо обнуления, чтобы buildIndex() мог работать
    this.index = new FlexSearch.Document({
      document: {
        id: 'id',
        index: ['content', 'filePath'],
        store: ['filePath', 'line', 'column', 'content'],
      },
      tokenize: 'forward',
      cache: 100,
    });
    this.indexedFiles.clear();
    this.fileContents.clear();
    logger.info('Индекс очищен и пересоздан', 'SearchIndex');
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
      '*.min.css',
    ];

    const scanDir = async (dir: string): Promise<void> => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Проверяем, находится ли текущая директория или файл в списке исключений
        const isExcluded = excludePatterns.some((pattern) => {
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
            '.ts',
            '.tsx',
            '.js',
            '.jsx',
            '.py',
            '.java',
            '.cpp',
            '.c',
            '.h',
            '.md',
            '.json',
            '.yaml',
            '.yml',
            '.xml',
            '.html',
            '.css',
            '.scss',
            '.sql',
            '.sh',
            '.bash',
            '.txt',
            '.log',
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

  // ========== SEMANTIC SEARCH (BCK-29) ==========

  /**
   * Векторизует все узлы графа без embeddings
   * Используется для первоначальной индексации или после добавления новых узлов
   */
  async buildNodeEmbeddings(): Promise<number> {
    if (!this.embeddingService || !this.memoryStore) {
      throw new Error(
        'Semantic search dependencies not initialized. Call setSemanticDependencies() first.'
      );
    }

    const nodesWithoutEmbeddings = await this.memoryStore.findNodesWithoutEmbeddings();

    if (nodesWithoutEmbeddings.length === 0) {
      logger.info('Все узлы уже имеют embeddings', 'SearchIndex');
      return 0;
    }

    logger.info(`Векторизация ${nodesWithoutEmbeddings.length} узлов...`, 'SearchIndex');

    let processedCount = 0;
    for (const node of nodesWithoutEmbeddings) {
      try {
        await this.updateNodeEmbedding(node.id);
        processedCount++;
      } catch (error) {
        logger.error(`Ошибка векторизации узла ${node.id}`, error, 'SearchIndex');
      }
    }

    logger.info(`Векторизовано ${processedCount} узлов`, 'SearchIndex');
    return processedCount;
  }

  /**
   * Обновляет embedding для конкретного узла
   */
  async updateNodeEmbedding(nodeId: string): Promise<void> {
    if (!this.embeddingService || !this.memoryStore) {
      throw new Error(
        'Semantic search dependencies not initialized. Call setSemanticDependencies() first.'
      );
    }

    const node = await this.memoryStore.getNode(nodeId);
    if (!node) {
      throw new Error(`Узел не найден: ${nodeId}`);
    }

    // Формируем текст для векторизации
    const text = this.embeddingService.buildEmbeddingText(node);

    // Генерируем embedding
    const embedding = await this.embeddingService.generateEmbedding(text);

    // Вычисляем хеш текста для отслеживания изменений
    const textHash = this.hashText(text);

    // Сохраняем в БД
    await this.memoryStore.saveNodeEmbedding(
      nodeId,
      embedding,
      'Xenova/all-MiniLM-L6-v2',
      384,
      textHash
    );

    logger.debug(`Embedding обновлён для узла: ${node.name}`, 'SearchIndex');
  }

  /**
   * Семантический поиск по памяти с использованием косинусного сходства
   * @param query - Текстовый запрос
   * @param topK - Количество результатов (по умолчанию 10)
   * @returns Массив результатов с оценкой сходства
   */
  async searchMemory(query: string, topK: number = 10): Promise<MemorySearchResult[]> {
    if (!this.embeddingService || !this.memoryStore) {
      throw new Error(
        'Semantic search dependencies not initialized. Call setSemanticDependencies() first.'
      );
    }

    // Генерируем embedding для запроса
    const queryEmbedding = await this.embeddingService.generateEmbedding(query);

    // Получаем все embeddings из БД
    const allEmbeddings = await this.memoryStore.getAllNodeEmbeddings();

    if (allEmbeddings.length === 0) {
      logger.warn('Нет embeddings для поиска', 'SearchIndex');
      return [];
    }

    // Вычисляем сходство для каждого embedding
    const results: MemorySearchResult[] = [];
    for (const item of allEmbeddings) {
      const similarity = this.embeddingService.cosineSimilarity(queryEmbedding, item.embedding);

      // Получаем полную информацию об узле
      const node = await this.memoryStore.getNode(item.nodeId);
      if (node) {
        results.push({
          node,
          similarity,
          embedding: item.embedding,
        });
      }
    }

    // Сортируем по убыванию сходства
    results.sort((a, b) => b.similarity - a.similarity);

    // Возвращаем top-K результатов
    return results.slice(0, topK);
  }

  /**
   * Полная перестройка всех embeddings
   * Удаляет старые embeddings и создаёт новые
   */
  async rebuildNodeEmbeddings(): Promise<number> {
    if (!this.embeddingService || !this.memoryStore) {
      throw new Error(
        'Semantic search dependencies not initialized. Call setSemanticDependencies() first.'
      );
    }

    logger.info('Полная перестройка embeddings...', 'SearchIndex');

    // Получаем все узлы
    const allNodes = await this.memoryStore.findNodes({});

    let processedCount = 0;
    for (const node of allNodes) {
      try {
        // Удаляем старый embedding (если есть)
        await this.memoryStore.deleteNodeEmbedding(node.id);

        // Создаём новый embedding
        await this.updateNodeEmbedding(node.id);
        processedCount++;
      } catch (error) {
        logger.error(`Ошибка перестройки embedding для узла ${node.id}`, error, 'SearchIndex');
      }
    }

    logger.info(`Перестроено ${processedCount} embeddings`, 'SearchIndex');
    return processedCount;
  }

  /**
   * Вычисляет хеш текста для отслеживания изменений
   */
  private hashText(text: string): string {
    // Простой хеш на основе суммы кодов символов
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}

/**
 * Результат семантического поиска
 */
export interface MemorySearchResult {
  node: GraphNode;
  similarity: number;
  embedding: Float32Array;
}
