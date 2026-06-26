import * as fs from 'fs';
import * as path from 'path';
import initSqlJs, { Database } from 'sql.js';
import {
  IMemoryStore,
  GraphNode,
  GraphEdge,
  ProjectInfo,
  FindNodesOptions,
  FindEdgesOptions,
  NodeType,
  EdgeType
} from '../interfaces/IMemoryStore';
import { logger } from '../utils/logger';

/**
 * MemoryStore — реализация графовой памяти на SQLite.
 * 
 * Использует sql.js (SQLite в WebAssembly) для работы без нативных зависимостей.
 * БД хранится в .devil/memory.db проекта.
 */
export class MemoryStore implements IMemoryStore {
  private db: Database | null = null;
  private dbPath: string = '';

  async initialize(projectPath: string): Promise<void> {
    const devilPath = path.join(projectPath, '.devil');
    if (!fs.existsSync(devilPath)) {
      fs.mkdirSync(devilPath, { recursive: true });
    }

    this.dbPath = path.join(devilPath, 'memory.db');

    // Инициализируем sql.js
    const SQL = await initSqlJs();

    // Загружаем существующую БД или создаём новую
    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
      logger.info('БД загружена из ' + this.dbPath, 'MemoryStore');
    } else {
      this.db = new SQL.Database();
      logger.info('Создана новая БД в ' + this.dbPath, 'MemoryStore');
    }

    // Создаём таблицы, если их нет
    this.createTables();
    this.save();

    logger.info('MemoryStore инициализирован для проекта: ' + projectPath, 'MemoryStore');
  }

  private createTables(): void {
    if (!this.db) return;

    this.db.run(`
      CREATE TABLE IF NOT EXISTS nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        signature TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER NOT NULL,
        target_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        metadata TEXT,
        FOREIGN KEY (source_id) REFERENCES nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES nodes(id) ON DELETE CASCADE
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS project_info (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        last_scan_at INTEGER NOT NULL
      )
    `);

    // Индексы для быстрого поиска
    this.db.run('CREATE INDEX IF NOT EXISTS idx_nodes_path ON nodes(path)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type)');

    logger.debug('Таблицы созданы/проверены', 'MemoryStore');
  }

  private save(): void {
    if (!this.db) return;
    
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    } catch (error) {
      logger.error('Не удалось сохранить БД', error, 'MemoryStore');
    }
  }

  async addNode(node: GraphNode): Promise<number> {
    if (!this.db) throw new Error('MemoryStore не инициализирован');

    const now = Date.now();
    const metadata = node.metadata ? JSON.stringify(node.metadata) : null;

    this.db.run(
      'INSERT INTO nodes (type, name, path, signature, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [node.type, node.name, node.path, node.signature || null, metadata, now, now]
    );

    const result = this.db.exec('SELECT last_insert_rowid() as id');
    const id = result[0].values[0][0] as number;

    this.save();
    logger.debug('Узел добавлен: ' + node.type + ':' + node.name + ' (id=' + id + ')', 'MemoryStore');
    return id;
  }

  async addEdge(edge: GraphEdge): Promise<number> {
    if (!this.db) throw new Error('MemoryStore не инициализирован');

    const metadata = edge.metadata ? JSON.stringify(edge.metadata) : null;

    this.db.run(
      'INSERT INTO edges (source_id, target_id, type, metadata) VALUES (?, ?, ?, ?)',
      [edge.source_id, edge.target_id, edge.type, metadata]
    );

    const result = this.db.exec('SELECT last_insert_rowid() as id');
    const id = result[0].values[0][0] as number;

    this.save();
    logger.debug('Связь добавлена: ' + edge.source_id + ' -> ' + edge.target_id + ' (' + edge.type + ')', 'MemoryStore');
    return id;
  }

  async findNodes(options: FindNodesOptions): Promise<GraphNode[]> {
    if (!this.db) return [];

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }
    if (options.name) {
      conditions.push('name LIKE ?');
      params.push('%' + options.name + '%');
    }
    if (options.path) {
      conditions.push('path LIKE ?');
      params.push('%' + options.path + '%');
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const limit = options.limit ? 'LIMIT ' + options.limit : '';
    const offset = options.offset ? 'OFFSET ' + options.offset : '';

    const query = 'SELECT * FROM nodes ' + whereClause + ' ' + limit + ' ' + offset;
    const result = this.db.exec(query, params);

    if (result.length === 0) return [];

    return result[0].values.map((row: unknown[]) => this.rowToNode(result[0].columns, row));
  }

  async findEdges(options: FindEdgesOptions): Promise<GraphEdge[]> {
    if (!this.db) return [];

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.source_id !== undefined) {
      conditions.push('source_id = ?');
      params.push(options.source_id);
    }
    if (options.target_id !== undefined) {
      conditions.push('target_id = ?');
      params.push(options.target_id);
    }
    if (options.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const limit = options.limit ? 'LIMIT ' + options.limit : '';

    const query = 'SELECT * FROM edges ' + whereClause + ' ' + limit;
    const result = this.db.exec(query, params);

    if (result.length === 0) return [];

    return result[0].values.map((row: unknown[]) => this.rowToEdge(result[0].columns, row));
  }

  async getNodeByPath(filePath: string): Promise<GraphNode | null> {
    const nodes = await this.findNodes({ path: filePath, limit: 1 });
    return nodes.length > 0 ? nodes[0] : null;
  }

  async getNodeByName(name: string): Promise<GraphNode[]> {
    return await this.findNodes({ name: name });
  }

  async getGraphForFile(filePath: string): Promise<{
    node: GraphNode | null;
    incoming: GraphEdge[];
    outgoing: GraphEdge[];
    relatedNodes: GraphNode[];
  }> {
    const node = await this.getNodeByPath(filePath);
    
    if (!node || !node.id) {
      return { node: null, incoming: [], outgoing: [], relatedNodes: [] };
    }

    const outgoing = await this.findEdges({ source_id: node.id });
    const incoming = await this.findEdges({ target_id: node.id });

    // Собираем все связанные узлы
    const relatedNodeIds = new Set<number>();
    outgoing.forEach(e => relatedNodeIds.add(e.target_id));
    incoming.forEach(e => relatedNodeIds.add(e.source_id));

    const relatedNodes: GraphNode[] = [];
    for (const id of relatedNodeIds) {
      const result = this.db!.exec('SELECT * FROM nodes WHERE id = ?', [id]);
      if (result.length > 0 && result[0].values.length > 0) {
        relatedNodes.push(this.rowToNode(result[0].columns, result[0].values[0]));
      }
    }

    return { node, incoming, outgoing, relatedNodes };
  }

  async updateProjectInfo(info: ProjectInfo): Promise<void> {
    if (!this.db) throw new Error('MemoryStore не инициализирован');

    const now = Date.now();
    
    // Проверяем, существует ли запись
    const existing = this.db.exec('SELECT id FROM project_info WHERE path = ?', [info.path]);
    
    if (existing.length > 0 && existing[0].values.length > 0) {
      this.db.run(
        'UPDATE project_info SET name = ?, last_scan_at = ? WHERE path = ?',
        [info.name, now, info.path]
      );
    } else {
      this.db.run(
        'INSERT INTO project_info (path, name, last_scan_at) VALUES (?, ?, ?)',
        [info.path, info.name, now]
      );
    }

    this.save();
    logger.debug('Информация о проекте обновлена: ' + info.name, 'MemoryStore');
  }

  async getProjectInfo(): Promise<ProjectInfo | null> {
    if (!this.db) return null;

    const result = this.db.exec('SELECT * FROM project_info LIMIT 1');
    
    if (result.length === 0 || result[0].values.length === 0) {
      return null;
    }

    const columns = result[0].columns;
    const row = result[0].values[0];
    
    return {
      id: row[columns.indexOf('id')] as number,
      path: row[columns.indexOf('path')] as string,
      name: row[columns.indexOf('name')] as string,
      last_scan_at: row[columns.indexOf('last_scan_at')] as number
    };
  }

  async clear(): Promise<void> {
    if (!this.db) return;

    this.db.run('DELETE FROM edges');
    this.db.run('DELETE FROM nodes');
    this.db.run('DELETE FROM project_info');
    
    this.save();
    logger.info('БД очищена', 'MemoryStore');
  }

  async close(): Promise<void> {
    if (this.db) {
      this.save();
      this.db.close();
      this.db = null;
      logger.info('Соединение с БД закрыто', 'MemoryStore');
    }
  }

  private rowToNode(columns: string[], row: unknown[]): GraphNode {
    const getValue = (col: string) => row[columns.indexOf(col)];
    
    const metadataStr = getValue('metadata') as string | null;
    const metadata = metadataStr ? JSON.parse(metadataStr) : undefined;

    return {
      id: getValue('id') as number,
      type: getValue('type') as NodeType,
      name: getValue('name') as string,
      path: getValue('path') as string,
      signature: getValue('signature') as string | undefined,
      metadata,
      created_at: getValue('created_at') as number,
      updated_at: getValue('updated_at') as number
    };
  }

  private rowToEdge(columns: string[], row: unknown[]): GraphEdge {
    const getValue = (col: string) => row[columns.indexOf(col)];
    
    const metadataStr = getValue('metadata') as string | null;
    const metadata = metadataStr ? JSON.parse(metadataStr) : undefined;

    return {
      id: getValue('id') as number,
      source_id: getValue('source_id') as number,
      target_id: getValue('target_id') as number,
      type: getValue('type') as EdgeType,
      metadata
    };
  }
}
