/**
 * Интерфейс для работы с графовой памятью.
 * 
 * Определяет контракт для хранения и поиска сущностей проекта (файлы, классы, функции, технологии)
 * и связей между ними (импорты, вызовы, зависимости).
 * 
 * Реализация использует SQLite для хранения данных в файле .devil/memory.db.
 * 
 * @example
 * ```typescript
 * const store = new MemoryStore();
 * await store.initialize('.devil/memory.db');
 * 
 * // Добавление узла
 * await store.addNode({
 *   id: '550e8400-e29b-41d4-a716-446655440000',
 *   type: 'function',
 *   name: 'handleSubmit',
 *   path: 'src/components/Form.tsx',
 *   createdAt: Date.now(),
 *   updatedAt: Date.now()
 * });
 * 
 * // Поиск узлов
 * const functions = await store.findNodes({ type: 'function' });
 * ```
 */
export interface IMemoryStore {
  /**
   * Инициализирует хранилище (создаёт таблицы, если их нет).
   * 
   * @param dbPath - Путь к файлу SQLite БД (например, '.devil/memory.db')
   * @throws {MemoryError} Если не удалось инициализировать БД
   */
  initialize(dbPath: string): Promise<void>;

  /**
   * Закрывает соединение с БД.
   * Должен вызываться при деактивации расширения.
   */
  close(): Promise<void>;

  // === Операции с узлами (Nodes) ===

  /**
   * Добавляет новый узел в граф.
   * 
   * @param node - Узел для добавления
   * @throws {MemoryError} Если узел с таким ID уже существует
   */
  addNode(node: GraphNode): Promise<void>;

  /**
   * Получает узел по ID.
   * 
   * @param id - UUID узла
   * @returns Узел или null, если не найден
   */
  getNode(id: string): Promise<GraphNode | null>;

  /**
   * Ищет узлы по заданным критериям.
   * 
   * @param query - Критерии поиска (тип, имя, путь, теги)
   * @returns Массив найденных узлов
   */
  findNodes(query: NodeQuery): Promise<GraphNode[]>;

  /**
   * Обновляет существующий узел.
   * 
   * @param id - UUID узла
   * @param updates - Поля для обновления (частичный GraphNode)
   * @throws {MemoryError} Если узел не найден
   */
  updateNode(id: string, updates: Partial<GraphNode>): Promise<void>;

  /**
   * Удаляет узел и все связанные связи.
   * 
   * @param id - UUID узла
   * @throws {MemoryError} Если узел не найден
   */
  deleteNode(id: string): Promise<void>;

  // === Операции со связями (Edges) ===

  /**
   * Добавляет новую связь между узлами.
   * 
   * @param edge - Связь для добавления
   * @throws {MemoryError} Если связь с таким ID уже существует или узлы не найдены
   */
  addEdge(edge: GraphEdge): Promise<void>;

  /**
   * Получает все связи, исходящие от узла.
   * 
   * @param nodeId - UUID узла-источника
   * @returns Массив исходящих связей
   */
  getEdgesFrom(nodeId: string): Promise<GraphEdge[]>;

  /**
   * Получает все связи, входящие в узел.
   * 
   * @param nodeId - UUID узла-целевого
   * @returns Массив входящих связей
   */
  getEdgesTo(nodeId: string): Promise<GraphEdge[]>;

  /**
   * Удаляет связь по ID.
   * 
   * @param id - UUID связи
   * @throws {MemoryError} Если связь не найдена
   */
  deleteEdge(id: string): Promise<void>;

  // === Операции с тегами ===

  /**
   * Добавляет тег к узлу.
   * 
   * @param nodeId - UUID узла
   * @param tagName - Имя тега (создаётся, если не существует)
   */
  addTagToNode(nodeId: string, tagName: string): Promise<void>;

  /**
   * Удаляет тег у узла.
   * 
   * @param nodeId - UUID узла
   * @param tagName - Имя тега
   */
  removeTagFromNode(nodeId: string, tagName: string): Promise<void>;

  /**
   * Получает все теги узла.
   * 
   * @param nodeId - UUID узла
   * @returns Массив имён тегов
   */
  getNodeTags(nodeId: string): Promise<string[]>;

  /**
   * Ищет узлы по тегу.
   * 
   * @param tagName - Имя тега
   * @returns Массив узлов с этим тегом
   */
  findNodesByTag(tagName: string): Promise<GraphNode[]>;

  // === Операции с кэшем ===

  /**
   * Сохраняет ответ LLM в кэш.
   * 
   * @param entry - Запись кэша (промпт, ответ, модель, токены)
   */
  cacheResponse(entry: CacheEntry): Promise<void>;

  /**
   * Получает кэшированный ответ по хэшу промпта.
   * 
   * @param promptHash - SHA-256 хэш промпта
   * @returns Запись кэша или null, если не найдена или устарела
   */
  getCachedResponse(promptHash: string): Promise<CacheEntry | null>;

  /**
   * Очищает устаревшие записи кэша.
   * 
   * @returns Количество удалённых записей
   */
  clearExpiredCache(): Promise<number>;

  // === Операции с историей диалогов ===

  /**
   * Сохраняет сообщение в историю диалога.
   * 
   * @param message - Сообщение (роль, контент, метаданные)
   */
  addDialogMessage(message: DialogMessage): Promise<void>;

  /**
   * Получает историю диалога для проекта.
   * 
   * @param projectPath - Путь к проекту
   * @param limit - Максимальное количество сообщений (по умолчанию все)
   * @returns Массив сообщений, отсортированных по времени
   */
  getDialogHistory(projectPath: string, limit?: number): Promise<DialogMessage[]>;

  /**
   * Очищает историю диалога для проекта.
   * 
   * @param projectPath - Путь к проекту
   */
  clearDialogHistory(projectPath: string): Promise<void>;

  // === Операции с логом изменений ===

  /**
   * Добавляет запись в лог изменений.
   * 
   * @param entry - Запись лога (действие, цель, описание)
   */
  addChangeLogEntry(entry: ChangeLogEntry): Promise<void>;

  /**
   * Получает лог изменений для проекта.
   * 
   * @param projectPath - Путь к проекту
   * @param limit - Максимальное количество записей
   * @returns Массив записей, отсортированных по времени (новые первыми)
   */
  getChangeLog(projectPath: string, limit?: number): Promise<ChangeLogEntry[]>;
}

/**
 * Узел графа памяти.
 */
export interface GraphNode {
  /**
   * UUID узла (генерируется при создании).
   */
  id: string;

  /**
   * Тип сущности.
   */
  type: NodeType;

  /**
   * Имя сущности (например, 'App', 'handleSubmit', 'React').
   */
  name: string;

  /**
   * Путь к файлу (для file, class, function).
   */
  path?: string;

  /**
   * Дополнительные метаданные (JSON).
   * Например: { "line": 42, "exported": true, "async": true }
   */
  metadata?: Record<string, any>;

  /**
   * Теги узла (массив имён тегов).
   */
  tags?: string[];

  /**
   * Unix timestamp создания (в миллисекундах).
   */
  createdAt: number;

  /**
   * Unix timestamp последнего обновления (в миллисекундах).
   */
  updatedAt: number;
}

/**
 * Тип узла графа.
 */
export type NodeType = 
  | 'file'        // Файл проекта
  | 'class'       // Класс
  | 'function'    // Функция/метод
  | 'variable'    // Переменная/константа
  | 'technology'  // Технология/библиотека
  | 'decision'    // Архитектурное решение
  | 'concept';    // Концепция/паттерн

/**
 * Связь между узлами графа.
 */
export interface GraphEdge {
  /**
   * UUID связи (генерируется при создании).
   */
  id: string;

  /**
   * ID узла-источника.
   */
  from: string;

  /**
   * ID узла-целевого.
   */
  to: string;

  /**
   * Тип связи.
   */
  type: EdgeType;

  /**
   * Дополнительные метаданные (JSON).
   * Например: { "line": 15 }
   */
  metadata?: Record<string, any>;

  /**
   * Unix timestamp создания (в миллисекундах).
   */
  createdAt: number;
}

/**
 * Тип связи в графе.
 */
export type EdgeType = 
  | 'imports'      // Импортирует
  | 'calls'        // Вызывает
  | 'uses'         // Использует
  | 'depends_on'   // Зависит от
  | 'implements'   // Реализует (интерфейс)
  | 'extends'      // Наследует
  | 'contains';    // Содержит (файл содержит класс/функцию)

/**
 * Критерии поиска узлов.
 */
export interface NodeQuery {
  /**
   * Тип узла.
   */
  type?: NodeType;

  /**
   * Имя узла (точное совпадение или LIKE).
   */
  name?: string;

  /**
   * Путь к файлу (точное совпадение).
   */
  path?: string;

  /**
   * Теги (узлы должны иметь все указанные теги).
   */
  tags?: string[];

  /**
   * Максимальное количество результатов.
   */
  limit?: number;

  /**
   * Смещение для пагинации.
   */
  offset?: number;
}

/**
 * Запись кэша ответов LLM.
 */
export interface CacheEntry {
  /**
   * UUID записи.
   */
  id: string;

  /**
   * SHA-256 хэш промпта.
   */
  promptHash: string;

  /**
   * Полный текст промпта.
   */
  prompt: string;

  /**
   * Ответ LLM.
   */
  response: string;

  /**
   * Имя модели.
   */
  model: string;

  /**
   * Количество использованных токенов.
   */
  tokensUsed: number;

  /**
   * Unix timestamp создания (в миллисекундах).
   */
  createdAt: number;

  /**
   * Unix timestamp истечения срока действия (в миллисекундах).
   */
  expiresAt: number;
}

/**
 * Сообщение в истории диалога.
 */
export interface DialogMessage {
  /**
   * UUID сообщения.
   */
  id: string;

  /**
   * Путь к проекту.
   */
  projectPath: string;

  /**
   * Роль автора сообщения.
   */
  role: 'user' | 'assistant' | 'system';

  /**
   * Текст сообщения.
   */
  content: string;

  /**
   * Дополнительные метаданные (JSON).
   * Например: { "tokens": 150, "model": "gpt-4o-mini" }
   */
  metadata?: Record<string, any>;

  /**
   * Unix timestamp создания (в миллисекундах).
   */
  createdAt: number;
}

/**
 * Запись в логе изменений.
 */
export interface ChangeLogEntry {
  /**
   * UUID записи.
   */
  id: string;

  /**
   * Путь к проекту.
   */
  projectPath: string;

  /**
   * Тип действия.
   */
  action: 'create' | 'update' | 'delete' | 'scan' | 'generate';

  /**
   * Цель действия (путь к файлу или описание).
   */
  target: string;

  /**
   * Описание изменения.
   */
  description?: string;

  /**
   * Дополнительные метаданные (JSON).
   */
  metadata?: Record<string, any>;

  /**
   * Unix timestamp создания (в миллисекундах).
   */
  createdAt: number;
}

/**
 * Ошибка при работе с хранилищем.
 */
export class MemoryError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'MemoryError';
  }
}
