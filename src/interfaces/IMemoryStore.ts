/**
 * Тип узла в графе проекта.
 */
export type NodeType = 'file' | 'class' | 'function' | 'variable' | 'interface' | 'type' | 'module';

/**
 * Тип связи между узлами.
 */
export type EdgeType = 'imports' | 'extends' | 'implements' | 'calls' | 'references' | 'contains' | 'uses';

/**
 * Узел в графе проекта.
 */
export interface GraphNode {
  id?: number;
  type: NodeType;
  name: string;
  path: string;
  signature?: string;
  metadata?: Record<string, unknown>;
  created_at?: number;
  updated_at?: number;
}

/**
 * Связь между узлами.
 */
export interface GraphEdge {
  id?: number;
  source_id: number;
  target_id: number;
  type: EdgeType;
  metadata?: Record<string, unknown>;
}

/**
 * Информация о проекте.
 */
export interface ProjectInfo {
  id?: number;
  path: string;
  name: string;
  last_scan_at?: number;
}

/**
 * Опции поиска узлов.
 */
export interface FindNodesOptions {
  type?: NodeType;
  name?: string;
  path?: string;
  limit?: number;
  offset?: number;
}

/**
 * Опции поиска связей.
 */
export interface FindEdgesOptions {
  source_id?: number;
  target_id?: number;
  type?: EdgeType;
  limit?: number;
}

/**
 * IMemoryStore — интерфейс для работы с графовой памятью проекта.
 */
export interface IMemoryStore {
  /**
   * Инициализирует БД для проекта.
   */
  initialize(projectPath: string): Promise<void>;

  /**
   * Добавляет узел в граф.
   */
  addNode(node: GraphNode): Promise<number>;

  /**
   * Добавляет связь между узлами.
   */
  addEdge(edge: GraphEdge): Promise<number>;

  /**
   * Находит узлы по критериям.
   */
  findNodes(options: FindNodesOptions): Promise<GraphNode[]>;

  /**
   * Находит связи по критериям.
   */
  findEdges(options: FindEdgesOptions): Promise<GraphEdge[]>;

  /**
   * Получает узел по пути к файлу.
   */
  getNodeByPath(path: string): Promise<GraphNode | null>;

  /**
   * Получает узел по имени (символу).
   */
  getNodeByName(name: string): Promise<GraphNode[]>;

  /**
   * Получает граф для конкретного файла (узел + все связанные).
   */
  getGraphForFile(path: string): Promise<{
    node: GraphNode | null;
    incoming: GraphEdge[];
    outgoing: GraphEdge[];
    relatedNodes: GraphNode[];
  }>;

  /**
   * Обновляет информацию о проекте.
   */
  updateProjectInfo(info: ProjectInfo): Promise<void>;

  /**
   * Получает информацию о проекте.
   */
  getProjectInfo(): Promise<ProjectInfo | null>;

  /**
   * Очищает все данные.
   */
  clear(): Promise<void>;

  /**
   * Закрывает соединение с БД.
   */
  close(): Promise<void>;
}
