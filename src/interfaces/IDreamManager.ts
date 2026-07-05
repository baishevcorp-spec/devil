/**
 * Интерфейс для DreamManager — фоновое обслуживание графовой памяти
 * Задача: BCK-32
 */

import { GraphNode, GraphEdge } from './IMemoryStore';

export interface IDreamManager {
  /**
   * Запуск полного цикла Dream
   * Возвращает отчёт о выполненных операциях
   */
  runDream(): Promise<DreamReport>;

  /**
   * Дедупликация узлов по имени + пути
   * Объединяет похожие узлы, сохраняя связи
   */
  deduplicateNodes(): Promise<number>;

  /**
   * Удаление мёртвых связей
   * Удаляет связи, указывающие на несуществующие узлы
   */
  removeDeadEdges(): Promise<number>;

  /**
   * Консолидация custom_instructions
   * Удаляет повторяющиеся инструкции из user_profile
   */
  consolidateInstructions(): Promise<number>;

  /**
   * Перестроение индексов SQLite
   * Выполняет REINDEX для оптимизации производительности
   */
  rebuildIndexes(): Promise<void>;

  /**
   * Валидация графа
   * Проверяет целостность графа (нет ли "висячих" связей)
   */
  validateGraph(): Promise<ValidationResult>;
}

export interface DreamReport {
  deduplicatedNodes: number;
  removedEdges: number;
  consolidatedInstructions: number;
  validationErrors: string[];
  duration: number; // миллисекунды
  timestamp: number;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  type: 'orphan_edge' | 'missing_node' | 'circular_dependency';
  nodeId?: string;
  edgeId?: string;
  message: string;
}

export interface ValidationWarning {
  type: 'duplicate_node' | 'unused_tag' | 'old_embedding';
  nodeId?: string;
  message: string;
}
