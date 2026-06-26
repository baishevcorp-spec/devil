import * as path from 'path';
import { FileSystemService } from './FileSystemService';
import { IMemoryStore, GraphNode, GraphEdge } from '../interfaces/IMemoryStore';
import { logger } from '../utils/logger';

/**
 * Результат парсинга файла.
 */
export interface ParseResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * GraphBuilder — парсинг кода для построения графа проекта.
 *
 * Использует RegExp для извлечения:
 * - import statements
 * - class declarations
 * - function/method declarations
 * - interface/type declarations
 * - variable declarations
 */
export class GraphBuilder {
  constructor(
    private readonly fileSystemService: FileSystemService,
    private readonly memoryStore: IMemoryStore
  ) {
    logger.info('GraphBuilder инициализирован', 'GraphBuilder');
  }

  /**
   * Парсит файл и добавляет узлы/связи в MemoryStore.
   */
  async parseFile(filePath: string, projectPath: string): Promise<ParseResult> {
    const relativePath = path.relative(projectPath, filePath);

    try {
      const content = await this.fileSystemService.readFile(filePath);
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];

      // Создаём узел для файла
      const fileNode: GraphNode = {
        type: 'file',
        name: path.basename(filePath),
        path: relativePath,
        metadata: {
          extension: path.extname(filePath),
          size: content.length
        }
      };
      const fileId = await this.memoryStore.addNode(fileNode);
      fileNode.id = fileId;
      nodes.push(fileNode);

      // Парсим только TypeScript/JavaScript файлы
      const ext = path.extname(filePath).toLowerCase();
      if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
        const parsedNodes = this.parseCode(content, relativePath);

        // Добавляем узлы и создаём связи "contains"
        for (const node of parsedNodes) {
          const nodeId = await this.memoryStore.addNode(node);
          node.id = nodeId;
          nodes.push(node);

          // Связь: файл содержит этот символ
          edges.push({
            source_id: fileId,
            target_id: nodeId,
            type: 'contains'
          });
        }

        // Парсим импорты и создаём связ��
        const imports = this.parseImports(content);
        for (const importPath of imports) {
          // Пытаемся найти файл по импорту
          const importedFileNode = await this.memoryStore.getNodeByPath(importPath);
          if (importedFileNode && importedFileNode.id) {
            edges.push({
              source_id: fileId,
              target_id: importedFileNode.id,
              type: 'imports'
            });
          }
        }
      }

      logger.debug('Файл распарсен: ' + relativePath + ' (узлов: ' + nodes.length + ')', 'GraphBuilder');
      return { nodes, edges };
    } catch (error) {
      logger.error('Ошибка парсинга файла: ' + relativePath, error, 'GraphBuilder');
      return { nodes: [], edges: [] };
    }
  }

  /**
   * Парсит код и извлекает символы (классы, функции, интерфейсы, типы, переменные).
   */
  private parseCode(content: string, filePath: string): GraphNode[] {
    const nodes: GraphNode[] = [];

    // Парсим классы
    const classMatches = this.matchAll(/(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/g, content);
    for (const match of classMatches) {
      nodes.push({
        type: 'class',
        name: match[1],
        path: filePath,
        signature: match[0],
        metadata: {
          extends: match[2] || null
        }
      });
    }

    // Парсим функции (включая arrow functions)
    const functionMatches = this.matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g, content);
    for (const match of functionMatches) {
      nodes.push({
        type: 'function',
        name: match[1],
        path: filePath,
        signature: match[0],
        metadata: {
          params: match[2] || '',
          async: match[0].includes('async')
        }
      });
    }

    // Парсим arrow functions
    const arrowMatches = this.matchAll(/(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g, content);
    for (const match of arrowMatches) {
      nodes.push({
        type: 'function',
        name: match[1],
        path: filePath,
        signature: match[0],
        metadata: {
          params: match[2] || '',
          async: match[0].includes('async'),
          arrow: true
        }
      });
    }

    // Парсим интерфейсы
    const interfaceMatches = this.matchAll(/(?:export\s+)?interface\s+(\w+)/g, content);
    for (const match of interfaceMatches) {
      nodes.push({
        type: 'interface',
        name: match[1],
        path: filePath,
        signature: match[0]
      });
    }

    // Парсим типы
    const typeMatches = this.matchAll(/(?:export\s+)?type\s+(\w+)\s*=/g, content);
    for (const match of typeMatches) {
      nodes.push({
        type: 'type',
        name: match[1],
        path: filePath,
        signature: match[0]
      });
    }

    // Парсим переменные (const, let, var) — только экспортируемые
    const varMatches = this.matchAll(/export\s+(?:const|let|var)\s+(\w+)\s*(?::\s*([^=]+))?\s*=/g, content);
    for (const match of varMatches) {
      nodes.push({
        type: 'variable',
        name: match[1],
        path: filePath,
        signature: match[0],
        metadata: {
          type: match[2] || null
        }
      });
    }

    return nodes;
  }

  /**
   * Парсит import statements и возвращает пути к импортируемым модулям.
   */
  private parseImports(content: string): string[] {
    const imports: string[] = [];

    // import ... from '...'
    const importMatches = this.matchAll(/import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g, content);
    for (const match of importMatches) {
      imports.push(match[1]);
    }

    return imports;
  }

  /**
   * Вспомогательный метод для поиска всех совпадений RegExp.
   */
  private matchAll(regex: RegExp, content: string): RegExpExecArray[] {
    const matches: RegExpExecArray[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      matches.push(match);
    }

    return matches;
  }

  /**
   * Парсит весь проект и строит граф.
   */
  async parseProject(projectPath: string, files: string[]): Promise<void> {
    logger.info('Начало парсинга проекта: ' + files.length + ' файлов', 'GraphBuilder');

    let totalNodes = 0;
    let totalEdges = 0;

    for (const file of files) {
      const result = await this.parseFile(file, projectPath);
      totalNodes += result.nodes.length;
      totalEdges += result.edges.length;
    }

    // Добавляем связи в БД
    // (edges уже созданы в parseFile, но нужно их сохранить)
    // Это будет сделано в следующем шаге

    logger.info('Проект распарсен: ' + totalNodes + ' узлов, ' + totalEdges + ' связей', 'GraphBuilder');
  }

  /**
   * Инкрементально обновляет граф для файла.
   * Удаляет старые узлы файла и создаёт новые.
   */
  async updateForFile(filePath: string, projectPath: string): Promise<void> {
    const relativePath = path.relative(projectPath, filePath);
    logger.info('Инкрементальное обновление: ' + relativePath, 'GraphBuilder');

    try {
      // 1. Находим существующий узел файла
      const existingFileNode = await this.memoryStore.getNodeByPath(relativePath);

      if (existingFileNode && existingFileNode.id) {
        // 2. Удаляем все связи файла
        const outgoingEdges = await this.memoryStore.findEdges({ source_id: existingFileNode.id });
        for (const edge of outgoingEdges) {
          // Удаление связей будет реализовано в MemoryStore
          // Пока просто логируем
          logger.debug('Удаление связи: ' + edge.source_id + ' -> ' + edge.target_id, 'GraphBuilder');
        }

        // 3. Удаляем все узлы, которые содержит файл (кроме самого файла)
        const containedNodes = await this.memoryStore.findNodes({ path: relativePath });
        for (const node of containedNodes) {
          if (node.id !== existingFileNode.id) {
            // Удаление узлов будет реализовано в MemoryStore
            logger.debug('Удаление узла: ' + node.type + ':' + node.name, 'GraphBuilder');
          }
        }
      }

      // 4. Парсим файл заново и добавляем узлы/связи
      await this.parseFile(filePath, projectPath);

      logger.info('Файл обновлён: ' + relativePath, 'GraphBuilder');
    } catch (error) {
      logger.error('Ошибка обновления файла: ' + relativePath, error, 'GraphBuilder');
    }
  }
}
