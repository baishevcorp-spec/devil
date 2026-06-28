/**
 * Результат поиска.
 */
export interface SearchResult {
  filePath: string;
  line: number;
  column: number;
  content: string;
  score: number;
  highlights: string[];
}

/**
 * Опции поиска.
 */
export interface SearchOptions {
  limit?: number;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  filePattern?: string;
}

/**
 * ISearchIndex — интерфейс для полнотекстового поиска по проекту.
 */
export interface ISearchIndex {
  /**
   * Инициализирует индекс для проекта.
   */
  initialize(projectPath: string): Promise<void>;

  /**
   * Строит индекс по всем файлам проекта.
   */
  buildIndex(): Promise<void>;

  /**
   * Добавляет файл в индекс.
   */
  addToIndex(filePath: string): Promise<void>;

  /**
   * Обновляет файл в индексе.
   */
  updateInIndex(filePath: string): Promise<void>;

  /**
   * Удаляет файл из индекса.
   */
  removeFromIndex(filePath: string): Promise<void>;

  /**
   * Выполняет поиск по индексу.
   */
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;

  /**
   * Получает статистику индекса.
   */
  getStats(): Promise<{
    totalFiles: number;
    totalDocuments: number;
    indexSize: number;
  }>;

  /**
   * Очищает индекс.
   */
  clear(): Promise<void>;
}
