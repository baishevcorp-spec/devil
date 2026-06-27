import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import initSqlJs, { Database } from 'sql.js';
import {
  IMemoryStore,
  GraphNode,
  GraphEdge,
  Tag,
  CacheEntry,
  UserProfile,
  DialogMessage,
  ChangeLogEntry,
  FindNodesOptions,
  FindEdgesOptions,
  DialogQuery,
  ChangeLogQuery,
  NodeType,
  EdgeType,
  DialogRole,
  ChangeAction,
} from '../interfaces/IMemoryStore';
import { logger } from '../utils/logger';

export class MemoryStore implements IMemoryStore {
  private db: Database | null = null;
  private dbPath: string = '';
  private projectPath: string = '';

  async initialize(projectPath: string): Promise<void> {
    this.projectPath = projectPath;
    const devilPath = path.join(projectPath, '.devil');
    if (!fs.existsSync(devilPath)) {
      fs.mkdirSync(devilPath, { recursive: true });
    }

    this.dbPath = path.join(devilPath, 'memory.db');

    const SQL = await initSqlJs();

    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
      logger.info('БД загружена из ' + this.dbPath, 'MemoryStore');
    } else {
      this.db = new SQL.Database();
      logger.info('Создана новая БД в ' + this.dbPath, 'MemoryStore');
    }

    this.createTables();
    this.applyMigrations();
    this.save();

    logger.info('MemoryStore инициализирован для проекта: ' + projectPath, 'MemoryStore');
  }

  private createTables(): void {
    if (!this.db) return;

    this.db.run(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('file', 'class', 'function', 'variable', 'technology', 'decision', 'concept')),
        name TEXT NOT NULL,
        path TEXT,
        metadata TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS edges (
        id TEXT PRIMARY KEY,
        from_node TEXT NOT NULL,
        to_node TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('imports', 'calls', 'uses', 'depends_on', 'implements', 'extends', 'contains')),
        metadata TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL,
        FOREIGN KEY (from_node) REFERENCES nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (to_node) REFERENCES nodes(id) ON DELETE CASCADE
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS node_tags (
        node_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        PRIMARY KEY (node_id, tag_id),
        FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS cache (
        id TEXT PRIMARY KEY,
        prompt_hash TEXT NOT NULL UNIQUE,
        prompt TEXT NOT NULL,
        response TEXT NOT NULL,
        model TEXT NOT NULL,
        tokens_used INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        coding_style TEXT DEFAULT '{}',
        preferred_libraries TEXT DEFAULT '[]',
        preferred_patterns TEXT DEFAULT '[]',
        custom_instructions TEXT DEFAULT '[]',
        interaction_history TEXT DEFAULT '[]',
        updated_at INTEGER NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS dialog_history (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS change_log (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'scan', 'generate')),
        target TEXT NOT NULL,
        description TEXT,
        metadata TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at INTEGER NOT NULL
      )
    `);

    this.db.run('CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_nodes_path ON nodes(path)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_nodes_updated_at ON nodes(updated_at)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_edges_from_node ON edges(from_node)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_edges_to_node ON edges(to_node)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_cache_prompt_hash ON cache(prompt_hash)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_cache_expires_at ON cache(expires_at)');
    this.db.run(
      'CREATE INDEX IF NOT EXISTS idx_dialog_project_path ON dialog_history(project_path)'
    );
    this.db.run('CREATE INDEX IF NOT EXISTS idx_dialog_created_at ON dialog_history(created_at)');
    this.db.run(
      'CREATE INDEX IF NOT EXISTS idx_change_log_project_path ON change_log(project_path)'
    );
    this.db.run('CREATE INDEX IF NOT EXISTS idx_change_log_created_at ON change_log(created_at)');

    const profileExists = this.db.exec('SELECT id FROM user_profile WHERE id = 1');
    if (profileExists.length === 0 || profileExists[0].values.length === 0) {
      this.db.run(
        'INSERT INTO user_profile (id, coding_style, preferred_libraries, preferred_patterns, custom_instructions, interaction_history, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?)',
        ['{}', '[]', '[]', '[]', '[]', Date.now()]
      );
    }

    logger.debug('Таблицы созданы/проверены', 'MemoryStore');
  }

  private applyMigrations(): void {
    if (!this.db) return;

    const applied = this.getAppliedMigrationsSync();

    if (!applied.includes('001_initial_schema')) {
      this.db.run('INSERT INTO migrations (id, name, applied_at) VALUES (1, ?, ?)', [
        '001_initial_schema',
        Date.now(),
      ]);
      logger.info('Применена миграция: 001_initial_schema', 'MemoryStore');
    }
  }

  private getAppliedMigrationsSync(): string[] {
    if (!this.db) return [];
    const result = this.db.exec('SELECT name FROM migrations ORDER BY id');
    if (result.length === 0) return [];
    return result[0].values.map((row) => row[0] as string);
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

  private generateId(): string {
    return crypto.randomUUID();
  }

  private hashPrompt(prompt: string): string {
    return crypto.createHash('sha256').update(prompt).digest('hex');
  }

  private parseJson<T>(value: string | null | undefined): T {
    if (!value) return {} as T;
    try {
      return JSON.parse(value);
    } catch {
      return {} as T;
    }
  }

  // ========== NODES ==========

  async addNode(node: Omit<GraphNode, 'id' | 'created_at' | 'updated_at' | 'tags'> & { tags?: string[] }): Promise<string> {
    if (!this.db) throw new Error('MemoryStore не инициализирован');

    const id = this.generateId();
    const now = Date.now();
    const metadata = JSON.stringify(node.metadata || {});

    this.db.run(
      'INSERT INTO nodes (id, type, name, path, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, node.type, node.name, node.path || null, metadata, now, now]
    );

    if (node.tags && node.tags.length > 0) {
      for (const tagName of node.tags) {
        await this.addTagToNode(id, tagName);
      }
    }

    this.save();
    logger.debug(
      'Узел добавлен: ' + node.type + ':' + node.name + ' (id=' + id + ')',
      'MemoryStore'
    );
    return id;
  }

  async getNode(id: string): Promise<GraphNode | null> {
    if (!this.db) return null;

    const result = this.db.exec('SELECT * FROM nodes WHERE id = ?', [id]);
    if (result.length === 0 || result[0].values.length === 0) return null;

    const node = this.rowToNode(result[0].columns, result[0].values[0]);
    node.tags = await this.getNodeTags(id);
    return node;
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
    if (options.tag) {
      conditions.push(
        'id IN (SELECT node_id FROM node_tags WHERE tag_id IN (SELECT id FROM tags WHERE name = ?))'
      );
      params.push(options.tag);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const limit = options.limit ? 'LIMIT ' + options.limit : '';
    const offset = options.offset ? 'OFFSET ' + options.offset : '';

    const query = 'SELECT * FROM nodes ' + whereClause + ' ' + limit + ' ' + offset;
    const result = this.db.exec(query, params);

    if (result.length === 0) return [];

    const nodes = result[0].values.map((row) => this.rowToNode(result[0].columns, row));

    for (const node of nodes) {
      node.tags = await this.getNodeTags(node.id);
    }

    return nodes;
  }

  async updateNode(
    id: string,
    updates: Partial<Omit<GraphNode, 'id' | 'created_at'>>
  ): Promise<void> {
    if (!this.db) throw new Error('MemoryStore не инициализирован');

    const sets: string[] = [];
    const params: (string | number)[] = [];

    if (updates.type !== undefined) {
      sets.push('type = ?');
      params.push(updates.type);
    }
    if (updates.name !== undefined) {
      sets.push('name = ?');
      params.push(updates.name);
    }
    if (updates.path !== undefined) {
      sets.push('path = ?');
      params.push(updates.path);
    }
    if (updates.metadata !== undefined) {
      sets.push('metadata = ?');
      params.push(JSON.stringify(updates.metadata));
    }
    sets.push('updated_at = ?');
    params.push(Date.now());

    params.push(id);

    this.db.run('UPDATE nodes SET ' + sets.join(', ') + ' WHERE id = ?', params);
    this.save();
    logger.debug('Узел обновлён: ' + id, 'MemoryStore');
  }

  async deleteNode(id: string): Promise<void> {
    if (!this.db) throw new Error('MemoryStore не инициализирован');

    this.db.run('DELETE FROM nodes WHERE id = ?', [id]);
    this.save();
    logger.debug('Узел удалён: ' + id, 'MemoryStore');
  }

  async getNodeByPath(filePath: string): Promise<GraphNode | null> {
    const nodes = await this.findNodes({ path: filePath, limit: 1 });
    return nodes.length > 0 ? nodes[0] : null;
  }

  async getNodeByName(name: string): Promise<GraphNode[]> {
    return await this.findNodes({ name: name });
  }

  // ========== EDGES ==========

  async addEdge(edge: Omit<GraphEdge, 'id' | 'created_at'>): Promise<string> {
    if (!this.db) throw new Error('MemoryStore не инициализирован');

    const id = this.generateId();
    const metadata = JSON.stringify(edge.metadata || {});

    this.db.run(
      'INSERT INTO edges (id, from_node, to_node, type, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, edge.from_node, edge.to_node, edge.type, metadata, Date.now()]
    );

    this.save();
    logger.debug(
      'Связь добавлена: ' + edge.from_node + ' -> ' + edge.to_node + ' (' + edge.type + ')',
      'MemoryStore'
    );
    return id;
  }

  async getEdgesFrom(nodeId: string): Promise<GraphEdge[]> {
    return await this.findEdges({ from_node: nodeId });
  }

  async getEdgesTo(nodeId: string): Promise<GraphEdge[]> {
    return await this.findEdges({ to_node: nodeId });
  }

  async findEdges(options: FindEdgesOptions): Promise<GraphEdge[]> {
    if (!this.db) return [];

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.from_node !== undefined) {
      conditions.push('from_node = ?');
      params.push(options.from_node);
    }
    if (options.to_node !== undefined) {
      conditions.push('to_node = ?');
      params.push(options.to_node);
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

    return result[0].values.map((row) => this.rowToEdge(result[0].columns, row));
  }

  async deleteEdge(id: string): Promise<void> {
    if (!this.db) throw new Error('MemoryStore не инициализирован');

    this.db.run('DELETE FROM edges WHERE id = ?', [id]);
    this.save();
    logger.debug('Связь удалена: ' + id, 'MemoryStore');
  }

  async getGraphForFile(filePath: string): Promise<{
    node: GraphNode | null;
    incoming: GraphEdge[];
    outgoing: GraphEdge[];
    relatedNodes: GraphNode[];
  }> {
    const node = await this.getNodeByPath(filePath);

    if (!node) {
      return { node: null, incoming: [], outgoing: [], relatedNodes: [] };
    }

    const outgoing = await this.getEdgesFrom(node.id);
    const incoming = await this.getEdgesTo(node.id);

    const relatedNodeIds = new Set<string>();
    outgoing.forEach((e) => relatedNodeIds.add(e.to_node));
    incoming.forEach((e) => relatedNodeIds.add(e.from_node));

    const relatedNodes: GraphNode[] = [];
    for (const id of relatedNodeIds) {
      const related = await this.getNode(id);
      if (related) {
        relatedNodes.push(related);
      }
    }

    return { node, incoming, outgoing, relatedNodes };
  }

  // ========== TAGS ==========

  async addTag(name: string): Promise<string> {
    if (!this.db) throw new Error('MemoryStore не инициализирован');

    const existing = this.db.exec('SELECT id FROM tags WHERE name = ?', [name]);
    if (existing.length > 0 && existing[0].values.length > 0) {
      return existing[0].values[0][0] as string;
    }

    const id = this.generateId();
    this.db.run('INSERT INTO tags (id, name) VALUES (?, ?)', [id, name]);
    this.save();
    return id;
  }

  async getTags(): Promise<Tag[]> {
    if (!this.db) return [];

    const result = this.db.exec('SELECT * FROM tags ORDER BY name');
    if (result.length === 0) return [];

    return result[0].values.map((row) => ({
      id: row[0] as string,
      name: row[1] as string,
    }));
  }

  async addTagToNode(nodeId: string, tagName: string): Promise<void> {
    if (!this.db) throw new Error('MemoryStore не инициализирован');

    const tagId = await this.addTag(tagName);
    this.db.run('INSERT OR IGNORE INTO node_tags (node_id, tag_id) VALUES (?, ?)', [nodeId, tagId]);
    this.save();
  }

  async removeTagFromNode(nodeId: string, tagName: string): Promise<void> {
    if (!this.db) throw new Error('MemoryStore не инициализирован');

    this.db.run(
      'DELETE FROM node_tags WHERE node_id = ? AND tag_id IN (SELECT id FROM tags WHERE name = ?)',
      [nodeId, tagName]
    );
    this.save();
  }

  async getNodeTags(nodeId: string): Promise<Tag[]> {
    if (!this.db) return [];

    const result = this.db.exec(
      'SELECT t.id, t.name FROM tags t JOIN node_tags nt ON t.id = nt.tag_id WHERE nt.node_id = ?',
      [nodeId]
    );
    if (result.length === 0) return [];

    return result[0].values.map((row) => ({
      id: row[0] as string,
      name: row[1] as string,
    }));
  }

  // ========== CACHE ==========

  async saveToCache(entry: Omit<CacheEntry, 'id'>): Promise<void> {
    if (!this.db) throw new Error('MemoryStore не инициализирован');

    const id = this.generateId();
    const prompt_hash = entry.prompt_hash || this.hashPrompt(entry.prompt);

    this.db.run(
      'INSERT OR REPLACE INTO cache (id, prompt_hash, prompt, response, model, tokens_used, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        prompt_hash,
        entry.prompt,
        entry.response,
        entry.model,
        entry.tokens_used,
        entry.created_at,
        entry.expires_at,
      ]
    );
    this.save();
  }

  async getFromCache(prompt_hash: string): Promise<CacheEntry | null> {
    if (!this.db) return null;

    const result = this.db.exec('SELECT * FROM cache WHERE prompt_hash = ? AND expires_at > ?', [
      prompt_hash,
      Date.now(),
    ]);
    if (result.length === 0 || result[0].values.length === 0) return null;

    return this.rowToCache(result[0].columns, result[0].values[0]);
  }

  async clearExpiredCache(): Promise<number> {
    if (!this.db) return 0;

    const now = Date.now();
    
    // Считаем количество устаревших записей перед удалением
    const countResult = this.db.exec('SELECT COUNT(*) FROM cache WHERE expires_at <= ?', [now]);
    const count = countResult.length > 0 ? (countResult[0].values[0][0] as number) : 0;
    
    this.db.run('DELETE FROM cache WHERE expires_at <= ?', [now]);
    this.save();
    
    return count;
  }

  // ========== USER PROFILE ==========

  async getUserProfile(): Promise<UserProfile | null> {
    if (!this.db) return null;

    const result = this.db.exec('SELECT * FROM user_profile WHERE id = 1');
    if (result.length === 0 || result[0].values.length === 0) return null;

    return this.rowToProfile(result[0].columns, result[0].values[0]);
  }

  async updateUserProfile(updates: Partial<Omit<UserProfile, 'id'>>): Promise<void> {
    if (!this.db) throw new Error('MemoryStore не инициализирован');

    const sets: string[] = [];
    const params: (string | number)[] = [];

    if (updates.coding_style !== undefined) {
      sets.push('coding_style = ?');
      params.push(JSON.stringify(updates.coding_style));
    }
    if (updates.preferred_libraries !== undefined) {
      sets.push('preferred_libraries = ?');
      params.push(JSON.stringify(updates.preferred_libraries));
    }
    if (updates.preferred_patterns !== undefined) {
      sets.push('preferred_patterns = ?');
      params.push(JSON.stringify(updates.preferred_patterns));
    }
    if (updates.custom_instructions !== undefined) {
      sets.push('custom_instructions = ?');
      params.push(JSON.stringify(updates.custom_instructions));
    }
    sets.push('updated_at = ?');
    params.push(Date.now());

    this.db.run('UPDATE user_profile SET ' + sets.join(', ') + ' WHERE id = 1', params);
    this.save();
    logger.info('Профиль пользователя обновлён', 'MemoryStore');
  }

  // ========== DIALOG HISTORY ==========

  async addDialogMessage(message: Omit<DialogMessage, 'id' | 'created_at'>): Promise<string> {
    if (!this.db) throw new Error('MemoryStore не инициализирован');

    const id = this.generateId();
    const metadata = JSON.stringify(message.metadata || {});

    this.db.run(
      'INSERT INTO dialog_history (id, project_path, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, message.project_path, message.role, message.content, metadata, Date.now()]
    );
    this.save();
    return id;
  }

  async getDialogHistory(query: DialogQuery): Promise<DialogMessage[]> {
    if (!this.db) return [];

    const conditions = ['project_path = ?'];
    const params: (string | number)[] = [query.project_path];

    if (query.role) {
      conditions.push('role = ?');
      params.push(query.role);
    }

    const whereClause = 'WHERE ' + conditions.join(' AND ');
    const limit = query.limit ? 'LIMIT ' + query.limit : '';
    const offset = query.offset ? 'OFFSET ' + query.offset : '';

    const result = this.db.exec(
      'SELECT * FROM dialog_history ' +
        whereClause +
        ' ORDER BY created_at ASC ' +
        limit +
        ' ' +
        offset,
      params
    );
    if (result.length === 0) return [];

    const columns = result[0].columns;
    return result[0].values.map((row) => this.rowToDialog(columns, row));
  }

  async clearDialogHistory(project_path: string): Promise<void> {
    if (!this.db) return;

    this.db.run('DELETE FROM dialog_history WHERE project_path = ?', [project_path]);
    this.save();
    logger.info('История диалога очищена для проекта: ' + project_path, 'MemoryStore');
  }

  // ========== CHANGE LOG ==========

  async addChangeLog(entry: Omit<ChangeLogEntry, 'id' | 'created_at'>): Promise<string> {
    if (!this.db) throw new Error('MemoryStore не инициализирован');

    const id = this.generateId();
    const metadata = JSON.stringify(entry.metadata || {});

    this.db.run(
      'INSERT INTO change_log (id, project_path, action, target, description, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        entry.project_path,
        entry.action,
        entry.target,
        entry.description || null,
        metadata,
        Date.now(),
      ]
    );
    this.save();
    return id;
  }

  async getChangeLog(query: ChangeLogQuery): Promise<ChangeLogEntry[]> {
    if (!this.db) return [];

    const conditions = ['project_path = ?'];
    const params: (string | number)[] = [query.project_path];

    if (query.action) {
      conditions.push('action = ?');
      params.push(query.action);
    }
    if (query.days) {
      conditions.push('created_at > ?');
      params.push(Date.now() - query.days * 24 * 60 * 60 * 1000);
    }

    const whereClause = 'WHERE ' + conditions.join(' AND ');
    const limit = query.limit ? 'LIMIT ' + query.limit : '';

    const result = this.db.exec(
      'SELECT * FROM change_log ' + whereClause + ' ORDER BY created_at DESC ' + limit,
      params
    );
    if (result.length === 0) return [];

    const columns = result[0].columns;
    return result[0].values.map((row) => this.rowToChangeLog(columns, row));
  }

  // ========== MIGRATIONS ==========

  async getAppliedMigrations(): Promise<string[]> {
    return this.getAppliedMigrationsSync();
  }

  async applyMigration(name: string): Promise<void> {
    if (!this.db) throw new Error('MemoryStore не инициализирован');

    const applied = await this.getAppliedMigrations();
    if (applied.includes(name)) {
      logger.info('Миграция уже применена: ' + name, 'MemoryStore');
      return;
    }

    this.db.run('INSERT INTO migrations (name, applied_at) VALUES (?, ?)', [name, Date.now()]);
    this.save();
    logger.info('Применена миграция: ' + name, 'MemoryStore');
  }

  async close(): Promise<void> {
    if (this.db) {
      this.save();
      this.db.close();
      this.db = null;
      logger.info('Соединение с БД закрыто', 'MemoryStore');
    }
  }

  // ========== HELPERS ==========

  private rowToNode(columns: string[], row: unknown[]): GraphNode {
    const getValue = (col: string): unknown => row[columns.indexOf(col)];
    const metadata = this.parseJson<Record<string, unknown>>(getValue('metadata') as string);

    return {
      id: getValue('id') as string,
      type: getValue('type') as NodeType,
      name: getValue('name') as string,
      path: (getValue('path') as string) || '',
      metadata,
      tags: [],
      created_at: getValue('created_at') as number,
      updated_at: getValue('updated_at') as number,
    };
  }

  private rowToEdge(columns: string[], row: unknown[]): GraphEdge {
    const getValue = (col: string): unknown => row[columns.indexOf(col)];
    const metadata = this.parseJson<Record<string, unknown>>(getValue('metadata') as string);

    return {
      id: getValue('id') as string,
      from_node: getValue('from_node') as string,
      to_node: getValue('to_node') as string,
      type: getValue('type') as EdgeType,
      metadata,
      created_at: getValue('created_at') as number,
    };
  }

  private rowToCache(columns: string[], row: unknown[]): CacheEntry {
    const getValue = (col: string): unknown => row[columns.indexOf(col)];

    return {
      id: getValue('id') as string,
      prompt_hash: getValue('prompt_hash') as string,
      prompt: getValue('prompt') as string,
      response: getValue('response') as string,
      model: getValue('model') as string,
      tokens_used: getValue('tokens_used') as number,
      created_at: getValue('created_at') as number,
      expires_at: getValue('expires_at') as number,
    };
  }

  private rowToProfile(columns: string[], row: unknown[]): UserProfile {
    const getValue = (col: string): unknown => row[columns.indexOf(col)];

    return {
      id: getValue('id') as number,
      coding_style: this.parseJson<Record<string, unknown>>(getValue('coding_style') as string),
      preferred_libraries: this.parseJson<string[]>(getValue('preferred_libraries') as string),
      preferred_patterns: this.parseJson<string[]>(getValue('preferred_patterns') as string),
      custom_instructions: this.parseJson<string[]>(getValue('custom_instructions') as string),
      interaction_history: this.parseJson<{ timestamp: number; action: string; details: string }[]>(getValue('interaction_history') as string),
      updated_at: getValue('updated_at') as number,
    };
  }

  private rowToDialog(columns: string[], row: unknown[]): DialogMessage {
    const getValue = (col: string): unknown => row[columns.indexOf(col)];
    const metadata = this.parseJson<Record<string, unknown>>(getValue('metadata') as string);

    return {
      id: getValue('id') as string,
      project_path: getValue('project_path') as string,
      role: getValue('role') as DialogRole,
      content: getValue('content') as string,
      metadata,
      created_at: getValue('created_at') as number,
    };
  }

  private rowToChangeLog(columns: string[], row: unknown[]): ChangeLogEntry {
    const getValue = (col: string): unknown => row[columns.indexOf(col)];
    const metadata = this.parseJson<Record<string, unknown>>(getValue('metadata') as string);

    return {
      id: getValue('id') as string,
      project_path: getValue('project_path') as string,
      action: getValue('action') as ChangeAction,
      target: getValue('target') as string,
      description: getValue('description') as string | undefined,
      metadata,
      created_at: getValue('created_at') as number,
    };
  }
}
