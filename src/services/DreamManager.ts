import { IDreamManager, DreamReport, ValidationResult, ValidationError, ValidationWarning } from '../interfaces/IDreamManager';
import { MemoryStore } from './MemoryStore';
import { GraphNode, GraphEdge } from '../interfaces/IMemoryStore';
import { UserProfileManager } from './UserProfileManager';
import { FileSystemService } from './FileSystemService';
import { logger } from '../utils/logger';
import * as path from 'path';

/**
 * DreamManager — фоновое обслуживание графовой памяти
 * Задача: BCK-32
 * 
 * Отвечает за:
 * - Дедупликация узлов (объединение похожих по имени + пути)
 * - Удаление мёртвых связей (если файл удалён)
 * - Консолидация custom_instructions
 * - Перестроение индексов SQLite
 * - Валидация графа
 * - Логирование всех операций в change_log
 */
export class DreamManager implements IDreamManager {
  private projectPath: string;

  constructor(
    private memoryStore: MemoryStore,
    private userProfileManager: UserProfileManager,
    private fileSystemService: FileSystemService,
    projectPath: string
  ) {
    this.projectPath = projectPath;
    logger.info('DreamManager создан', 'DreamManager');
  }

  /**
   * Запуск полного цикла Dream
   */
  async runDream(): Promise<DreamReport> {
    const startTime = Date.now();
    logger.info('Запуск Dream...', 'DreamManager');

    const report: DreamReport = {
      deduplicatedNodes: 0,
      removedEdges: 0,
      consolidatedInstructions: 0,
      validationErrors: [],
      duration: 0,
      timestamp: Date.now(),
    };

    try {
      // 1. Дедупликация узлов
      report.deduplicatedNodes = await this.deduplicateNodes();
      logger.info(`Дедуплицировано узлов: ${report.deduplicatedNodes}`, 'DreamManager');

      // 2. Удаление мёртвых связей
      report.removedEdges = await this.removeDeadEdges();
      logger.info(`Удалено мёртвых связей: ${report.removedEdges}`, 'DreamManager');

      // 3. Консолидация инструкций
      report.consolidatedInstructions = await this.consolidateInstructions();
      logger.info(`Консолидировано инструкций: ${report.consolidatedInstructions}`, 'DreamManager');

      // 4. Перестроение индексов
      await this.rebuildIndexes();
      logger.info('Индексы перестроены', 'DreamManager');

      // 5. Валидация графа
      const validation = await this.validateGraph();
      if (!validation.isValid) {
        report.validationErrors = validation.errors.map(e => e.message);
        logger.warn(`Ошибки валидации: ${report.validationErrors.length}`, 'DreamManager');
      }

      report.duration = Date.now() - startTime;
      report.timestamp = Date.now();

      // 6. Логирование в change_log
      await this.logDreamReport(report);

      logger.info(`Dream завершён за ${report.duration} мс`, 'DreamManager');
      return report;
    } catch (error) {
      logger.error('Ошибка выполнения Dream', error, 'DreamManager');
      throw error;
    }
  }

  /**
   * Дедупликация узлов по имени + пути
   * Объединяет узлы с одинаковым именем и путём, сохраняя связи
   */
  async deduplicateNodes(): Promise<number> {
    const allNodes = await this.memoryStore.findAllNodes();
    
    // Группируем узлы по ключу "name|path"
    const nodeGroups = new Map<string, GraphNode[]>();
    
    for (const node of allNodes) {
      const key = `${node.name}|${node.path || ''}`;
      if (!nodeGroups.has(key)) {
        nodeGroups.set(key, []);
      }
      nodeGroups.get(key)!.push(node);
    }

    let deduplicatedCount = 0;

    // Для каждой группы с дубликатами объединяем узлы
    for (const [key, nodes] of nodeGroups.entries()) {
      if (nodes.length <= 1) continue;

      // Оставляем первый узел (самый старый по created_at)
      nodes.sort((a, b) => a.created_at - b.created_at);
      const primaryNode = nodes[0];
      const duplicateNodes = nodes.slice(1);

      logger.debug(`Объединение дубликатов: ${key} (${duplicateNodes.length} дубликатов)`, 'DreamManager');

      // Переносим связи с дубликатов на основной узел
      for (const duplicate of duplicateNodes) {
        // Получаем все связи дубликата
        const outgoingEdges = await this.memoryStore.getEdgesFrom(duplicate.id);
        const incomingEdges = await this.memoryStore.getEdgesTo(duplicate.id);

        // Создаём новые связи для основного узла
        for (const edge of outgoingEdges) {
          if (edge.to_node !== primaryNode.id) {
            await this.memoryStore.addEdge({
              from_node: primaryNode.id,
              to_node: edge.to_node,
              type: edge.type,
              metadata: edge.metadata,
            });
          }
        }

        for (const edge of incomingEdges) {
          if (edge.from_node !== primaryNode.id) {
            await this.memoryStore.addEdge({
              from_node: edge.from_node,
              to_node: primaryNode.id,
              type: edge.type,
              metadata: edge.metadata,
            });
          }
        }

        // Удаляем дубликат (связи удалятся каскадно через FOREIGN KEY)
        await this.memoryStore.deleteNode(duplicate.id);
        deduplicatedCount++;
      }
    }

    return deduplicatedCount;
  }

  /**
   * Удаление мёртвых связей
   * Удаляет связи, указывающие на несуществующие узлы
   */
  async removeDeadEdges(): Promise<number> {
    const allEdges = await this.memoryStore.findAllEdges();
    let removedCount = 0;

    for (const edge of allEdges) {
      // Проверяем существование обоих узлов
      const fromNode = await this.memoryStore.getNode(edge.from_node);
      const toNode = await this.memoryStore.getNode(edge.to_node);

      if (!fromNode || !toNode) {
        logger.debug(`Удаление мёртвой связи: ${edge.id} (${edge.from_node} -> ${edge.to_node})`, 'DreamManager');
        await this.memoryStore.deleteEdge(edge.id);
        removedCount++;
      }
    }

    return removedCount;
  }

  /**
   * Консолидация custom_instructions
   * Удаляет повторяющиеся инструкции из user_profile
   */
  async consolidateInstructions(): Promise<number> {
    const profile = await this.userProfileManager.getProfile();
    if (!profile) {
      logger.debug('Профиль не найден, консолидация пропущена', 'DreamManager');
      return 0;
    }

    const instructions = profile.customInstructions || [];
    if (instructions.length === 0) {
      return 0;
    }

    // Удаляем дубликаты (с сохранением порядка)
    const uniqueInstructions = [...new Set(instructions)];
    const removedCount = instructions.length - uniqueInstructions.length;

    if (removedCount > 0) {
      await this.userProfileManager.updateProfile({
        customInstructions: uniqueInstructions,
      });
      logger.debug(`Удалено ${removedCount} дублирующихся инструкций`, 'DreamManager');
    }

    return removedCount;
  }

  /**
   * Перестроение индексов SQLite
   * Выполняет REINDEX для оптимизации производительности
   */
  async rebuildIndexes(): Promise<void> {
    try {
      this.memoryStore.executeSql('REINDEX');
      logger.debug('Индексы SQLite перестроены', 'DreamManager');
    } catch (error) {
      logger.error('Ошибка перестроения индексов', error, 'DreamManager');
      throw error;
    }
  }

  /**
   * Валидация графа
   * Проверяет целостность графа (нет ли "висячих" связей)
   */
  async validateGraph(): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // 1. Проверка связей на существование узлов
    const allEdges = await this.memoryStore.findAllEdges();
    for (const edge of allEdges) {
      const fromNode = await this.memoryStore.getNode(edge.from_node);
      const toNode = await this.memoryStore.getNode(edge.to_node);

      if (!fromNode) {
        errors.push({
          type: 'orphan_edge',
          edgeId: edge.id,
          message: `Связь ${edge.id} указывает на несуществующий узел ${edge.from_node}`,
        });
      }

      if (!toNode) {
        errors.push({
          type: 'orphan_edge',
          edgeId: edge.id,
          message: `Связь ${edge.id} указывает на несуществующий узел ${edge.to_node}`,
        });
      }
    }

    // 2. Проверка узлов без связей (предупреждение)
    const allNodes = await this.memoryStore.findAllNodes();
    for (const node of allNodes) {
      const outgoing = await this.memoryStore.getEdgesFrom(node.id);
      const incoming = await this.memoryStore.getEdgesTo(node.id);

      if (outgoing.length === 0 && incoming.length === 0) {
        warnings.push({
          type: 'unused_tag',
          nodeId: node.id,
          message: `Узел ${node.name} (${node.type}) не имеет связей`,
        });
      }
    }

    // 3. Проверка дубликатов узлов (предупреждение)
    const nodeGroups = new Map<string, GraphNode[]>();
    for (const node of allNodes) {
      const key = `${node.name}|${node.path || ''}`;
      if (!nodeGroups.has(key)) {
        nodeGroups.set(key, []);
      }
      nodeGroups.get(key)!.push(node);
    }

    for (const [key, nodes] of nodeGroups.entries()) {
      if (nodes.length > 1) {
        warnings.push({
          type: 'duplicate_node',
          nodeId: nodes[0].id,
          message: `Найдено ${nodes.length} дубликатов для узла: ${key}`,
        });
      }
    }

    const isValid = errors.length === 0;

    return {
      isValid,
      errors,
      warnings,
    };
  }

  /**
   * Логирование отчёта Dream в change_log
   */
  private async logDreamReport(report: DreamReport): Promise<void> {
    try {
      await this.memoryStore.logChange({
        project_path: this.projectPath,
        action: 'dream',
        target: 'dream_cycle',
        description: `Dream завершён: дедуплицировано ${report.deduplicatedNodes} узлов, удалено ${report.removedEdges} связей, консолидировано ${report.consolidatedInstructions} инструкций`,
        metadata: {
          duration_ms: report.duration,
          deduplicated_nodes: report.deduplicatedNodes,
          removed_edges: report.removedEdges,
          consolidated_instructions: report.consolidatedInstructions,
          validation_errors: report.validationErrors.length,
          timestamp: report.timestamp,
        },
      });
      logger.debug('Отчёт Dream залогирован в change_log', 'DreamManager');
    } catch (error) {
      logger.error('Ошибка логирования отчёта Dream', error, 'DreamManager');
    }
  }
}
