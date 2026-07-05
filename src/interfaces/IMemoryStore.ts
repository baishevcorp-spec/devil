export type NodeType =
  | 'file'
  | 'class'
  | 'function'
  | 'variable'
  | 'technology'
  | 'decision'
  | 'concept';

export type EdgeType =
  | 'imports'
  | 'calls'
  | 'uses'
  | 'depends_on'
  | 'implements'
  | 'extends'
  | 'contains';

export type DialogRole = 'user' | 'assistant' | 'system';

export type ChangeAction = 'create' | 'update' | 'delete' | 'scan' | 'generate' | 'lint_error' | 'search_hit' | 'dream' | 'extract' | 'recall' | 'forget';

export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  path?: string;
  metadata?: Record<string, unknown>;
  tags?: Tag[];
  created_at: number;
  updated_at: number;
}

export interface GraphEdge {
  id: string;
  from_node: string;
  to_node: string;
  type: EdgeType;
  metadata?: Record<string, unknown>;
  created_at: number;
}

export interface Tag {
  id: string;
  name: string;
}

export interface CacheEntry {
  id: string;
  prompt_hash: string;
  prompt: string;
  response: string;
  model: string;
  tokens_used: number;
  created_at: number;
  expires_at: number;
}

export interface UserProfile {
  id: number;
  coding_style: Record<string, unknown>;
  preferred_libraries: string[];
  preferred_patterns: string[];
  custom_instructions: string[];
  interaction_history: { timestamp: number; action: string; details: string }[];
  updated_at: number;
}

export interface DialogMessage {
  id: string;
  project_path: string;
  role: DialogRole;
  content: string;
  metadata?: Record<string, unknown>;
  created_at: number;
}

export interface ChangeLogEntry {
  id: string;
  project_path: string;
  action: ChangeAction;
  target: string;
  description?: string;
  metadata?: Record<string, unknown>;
  created_at: number;
}

export interface FindNodesOptions {
  type?: NodeType;
  name?: string;
  path?: string;
  tag?: string;
  limit?: number;
  offset?: number;
}

export interface FindEdgesOptions {
  from_node?: string;
  to_node?: string;
  type?: EdgeType;
  limit?: number;
}

export interface DialogQuery {
  project_path: string;
  limit?: number;
  offset?: number;
  role?: DialogRole;
}

export interface ChangeLogQuery {
  project_path: string;
  action?: ChangeAction;
  limit?: number;
  days?: number;
}

export interface IMemoryStore {
  initialize(projectPath: string): Promise<void>;
  close(): Promise<void>;

  addNode(node: Omit<GraphNode, 'id' | 'created_at' | 'updated_at' | 'tags'> & { tags?: string[] }): Promise<string>;
  getNode(id: string): Promise<GraphNode | null>;
  findNodes(options: FindNodesOptions): Promise<GraphNode[]>;
  updateNode(id: string, updates: Partial<Omit<GraphNode, 'id' | 'created_at'>>): Promise<void>;
  deleteNode(id: string): Promise<void>;
  getNodeByPath(path: string): Promise<GraphNode | null>;
  getNodeByName(name: string): Promise<GraphNode[]>;

  addEdge(edge: Omit<GraphEdge, 'id' | 'created_at'>): Promise<string>;
  getEdgesFrom(nodeId: string): Promise<GraphEdge[]>;
  getEdgesTo(nodeId: string): Promise<GraphEdge[]>;
  findEdges(options: FindEdgesOptions): Promise<GraphEdge[]>;
  deleteEdge(id: string): Promise<void>;
  getGraphForFile(path: string): Promise<{
    node: GraphNode | null;
    incoming: GraphEdge[];
    outgoing: GraphEdge[];
    relatedNodes: GraphNode[];
  }>;

  addTag(name: string): Promise<string>;
  getTags(): Promise<Tag[]>;
  addTagToNode(nodeId: string, tagName: string): Promise<void>;
  removeTagFromNode(nodeId: string, tagName: string): Promise<void>;
  getNodeTags(nodeId: string): Promise<Tag[]>;

  saveToCache(entry: Omit<CacheEntry, 'id'>): Promise<void>;
  getFromCache(prompt_hash: string): Promise<CacheEntry | null>;
  clearExpiredCache(): Promise<number>;

  getUserProfile(): Promise<UserProfile | null>;
  updateUserProfile(updates: Partial<Omit<UserProfile, 'id'>>): Promise<void>;

  addDialogMessage(message: Omit<DialogMessage, 'id' | 'created_at'>): Promise<string>;
  getDialogHistory(query: DialogQuery): Promise<DialogMessage[]>;
  clearDialogHistory(project_path: string): Promise<void>;

  addChangeLog(entry: Omit<ChangeLogEntry, 'id' | 'created_at'>): Promise<string>;
  getChangeLog(query: ChangeLogQuery): Promise<ChangeLogEntry[]>;

  getAppliedMigrations(): Promise<string[]>;
  applyMigration(name: string): Promise<void>;
}
