import * as path from 'path';
import { FileSystemService } from './FileSystemService';
import { IMemoryStore, NodeType } from '../interfaces/IMemoryStore';
import { logger } from '../utils/logger';

export interface ParseResult {
  nodes: string[];
  edges: string[];
}

export class GraphBuilder {
  private isUpdating: boolean = false;
  constructor(
    private readonly fileSystemService: FileSystemService,
    private readonly memoryStore: IMemoryStore
  ) {
    logger.info('GraphBuilder инициализирован', 'GraphBuilder');
  }

  async parseFile(filePath: string, projectPath: string): Promise<ParseResult> {
    const relativePath = path.relative(projectPath, filePath);

    // Исключаем Git временные файлы и служебные файлы
    if (relativePath.startsWith('.git') || relativePath.endsWith('.git')) {
      logger.debug('Файл исключён (Git): ' + relativePath, 'GraphBuilder');
      return { nodes: [], edges: [] };
    }

    try {
      const content = await this.fileSystemService.readFile(filePath);
      const nodes: string[] = [];
      const edges: string[] = [];

      // Проверяем, есть ли уже узел для этого файла (избегаем дубликатов)
      let fileId: string;
      const existingFileNode = await this.memoryStore.getNodeByPath(relativePath);
      if (existingFileNode) {
        // Файл уже есть в графе — обновляем метаданные
        fileId = existingFileNode.id;
        await this.memoryStore.updateNode(fileId, {
          metadata: {
            extension: path.extname(filePath),
            size: content.length
          }
        });
        // Удаляем старые связи contains, чтобы пересоздать их
        const oldEdges = await this.memoryStore.getEdgesFrom(fileId);
        for (const edge of oldEdges) {
          if (edge.type === 'contains') {
            await this.memoryStore.deleteEdge(edge.id);
          }
        }
        logger.debug('Файл уже в графе, обновлён: ' + relativePath, 'GraphBuilder');
      } else {
        // Файла нет — создаём новый узел
        fileId = await this.memoryStore.addNode({
          type: 'file',
          name: path.basename(filePath),
          path: relativePath,
          metadata: {
            extension: path.extname(filePath),
            size: content.length
          },
          tags: []
        });
      }
      nodes.push(fileId);

      const ext = path.extname(filePath).toLowerCase();
      if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
        const parsedNodes = this.parseCode(content, relativePath);

        for (const node of parsedNodes) {
          // Проверяем, есть ли уже узел с таким именем в этом файле
          let nodeId: string;
          // Используем type в запросе для точного поиска (исключаем узлы файлов)
          const existingNodes = await this.memoryStore.findNodes({
            type: node.type,
            name: node.name,
            path: relativePath
          });
          const existingNode = existingNodes.length > 0 ? existingNodes[0] : undefined;

          if (existingNode) {
            // Узел уже есть — обновляем метаданные
            nodeId = existingNode.id;
            await this.memoryStore.updateNode(nodeId, { metadata: node.metadata || {} });
          } else {
            // Создаём новый узел
            nodeId = await this.memoryStore.addNode(node);
          }
          nodes.push(nodeId);

          await this.memoryStore.addEdge({
            from_node: fileId,
            to_node: nodeId,
            type: 'contains',
            metadata: {}
          });
          edges.push(`${fileId}->${nodeId}`);
        }

        const imports = this.parseImports(content);
        for (const importPath of imports) {
          const importedFileNode = await this.memoryStore.getNodeByPath(importPath);
          if (importedFileNode) {
            await this.memoryStore.addEdge({
              from_node: fileId,
              to_node: importedFileNode.id,
              type: 'imports',
              metadata: {}
            });
            edges.push(`${fileId}->${importedFileNode.id}`);
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

  private parseCode(content: string, filePath: string): Array<Omit<import('../interfaces/IMemoryStore').GraphNode, 'id' | 'created_at' | 'updated_at' | 'tags'> & { tags?: string[] }> {
    const nodes: Array<Omit<import('../interfaces/IMemoryStore').GraphNode, 'id' | 'created_at' | 'updated_at' | 'tags'> & { tags?: string[] }> = [];

    const classMatches = this.matchAll(/(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/g, content);
    for (const match of classMatches) {
      nodes.push({
        type: 'class' as NodeType,
        name: match[1],
        path: filePath,
        metadata: {
          extends: match[2] || null
        },
        tags: []
      });
    }

    const functionMatches = this.matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g, content);
    for (const match of functionMatches) {
      nodes.push({
        type: 'function' as NodeType,
        name: match[1],
        path: filePath,
        metadata: {
          params: match[2] || '',
          async: match[0].includes('async')
        },
        tags: []
      });
    }

    const arrowMatches = this.matchAll(/(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g, content);
    for (const match of arrowMatches) {
      nodes.push({
        type: 'function' as NodeType,
        name: match[1],
        path: filePath,
        metadata: {
          params: match[2] || '',
          async: match[0].includes('async'),
          arrow: true
        },
        tags: []
      });
    }

    const interfaceMatches = this.matchAll(/(?:export\s+)?interface\s+(\w+)/g, content);
    for (const match of interfaceMatches) {
      nodes.push({
        type: 'class' as NodeType,
        name: match[1],
        path: filePath,
        metadata: {
          isInterface: true
        },
        tags: []
      });
    }

    const typeMatches = this.matchAll(/(?:export\s+)?type\s+(\w+)\s*=/g, content);
    for (const match of typeMatches) {
      nodes.push({
        type: 'concept' as NodeType,
        name: match[1],
        path: filePath,
        metadata: {
          isType: true
        },
        tags: []
      });
    }

    const varMatches = this.matchAll(/export\s+(?:const|let|var)\s+(\w+)\s*(?::\s*([^=]+))?\s*=/g, content);
    for (const match of varMatches) {
      nodes.push({
        type: 'variable' as NodeType,
        name: match[1],
        path: filePath,
        metadata: {
          type: match[2] || null,
          exported: true
        },
        tags: []
      });
    }

    return nodes;
  }

  private parseImports(content: string): string[] {
    const imports: string[] = [];

    const importMatches = this.matchAll(/import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g, content);
    for (const match of importMatches) {
      imports.push(match[1]);
    }

    return imports;
  }

  private matchAll(regex: RegExp, content: string): RegExpExecArray[] {
    const matches: RegExpExecArray[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      matches.push(match);
    }

    return matches;
  }

  async parseProject(projectPath: string, files: string[]): Promise<void> {
    logger.info('Начало парсинга проекта: ' + files.length + ' файлов', 'GraphBuilder');

    let totalNodes = 0;
    let totalEdges = 0;

    for (const file of files) {
      const result = await this.parseFile(file, projectPath);
      totalNodes += result.nodes.length;
      totalEdges += result.edges.length;
    }

    logger.info('Проект распарсен: ' + totalNodes + ' узлов, ' + totalEdges + ' связей', 'GraphBuilder');
  }

  async updateForFile(filePath: string, projectPath: string): Promise<void> {
    // Защита от рекурсии
    if (this.isUpdating) {
      logger.warn('updateForFile уже выполняется, пропускаем вызов', 'GraphBuilder');
      return;
    }

    this.isUpdating = true;

    try {
    const relativePath = path.relative(projectPath, filePath);
    logger.info('Инкрементальное обновление: ' + relativePath, 'GraphBuilder');

    try {
      const existingFileNode = await this.memoryStore.getNodeByPath(relativePath);

      if (existingFileNode) {
        const outgoingEdges = await this.memoryStore.getEdgesFrom(existingFileNode.id);
        for (const edge of outgoingEdges) {
          await this.memoryStore.deleteEdge(edge.id);
        }

        await this.memoryStore.deleteNode(existingFileNode.id);
      }

      await this.parseFile(filePath, projectPath);

      logger.info('Файл обновлён: ' + relativePath, 'GraphBuilder');
    } catch (error) {
      logger.error('Ошибка обновления файла: ' + relativePath, error, 'GraphBuilder');
    }
  }

    finally {
      this.isUpdating = false;
    }
  }
}
