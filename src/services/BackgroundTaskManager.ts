import * as vscode from 'vscode';
import { logger } from '../utils/logger';

/**
 * Статус фоновой задачи
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Интерфейс фоновой задачи
 */
export interface BackgroundTask<T = unknown> {
  id: string;
  name: string;
  status: TaskStatus;
  startedAt: number;
  completedAt?: number;
  result?: T;
  error?: Error;
  cancellable: boolean;
  cancelToken?: vscode.CancellationTokenSource;
}

/**
 * BackgroundTaskManager — управление фоновыми задачами (BCK-24).
 *
 * Отвечает за:
 * - Отслеживание длительных операций (запросы к LLM, сканирование проекта)
 * - Показ прогресса в VS Code при превышении порога (15 сек)
 * - Уведомления о завершении задач
 * - Возможность отмены задач
 *
 * @example
 * ```typescript
 * const taskManager = new BackgroundTaskManager();
 *
 * const result = await taskManager.run(
 *   'Генерация ответа',
 *   async () => {
 *     return await llmProvider.generate(prompt);
 *   },
 *   { thresholdMs: 15000 }
 * );
 * ```
 */
export class BackgroundTaskManager {
  private tasks: Map<string, BackgroundTask> = new Map();
  private readonly thresholdMs: number;

  constructor(thresholdMs: number = 15000) {
    this.thresholdMs = thresholdMs;
    logger.info(`BackgroundTaskManager инициализирован (порог: ${thresholdMs}мс)`, 'BackgroundTaskManager');
  }

  /**
   * Запускает задачу с отслеживанием времени выполнения.
   * Если задача выполняется дольше thresholdMs, показывает прогресс в VS Code.
   *
   * @param name - Название задачи (для отображения)
   * @param fn - Асинхронная функция задачи
   * @param options - Опции (порог, отменяемость)
   * @returns Результат задачи
   */
  async run<T>(
    name: string,
    fn: (cancellationToken?: vscode.CancellationToken) => Promise<T>,
    options: {
      thresholdMs?: number;
      cancellable?: boolean;
      showNotification?: boolean;
    } = {}
  ): Promise<T> {
    const threshold = options.thresholdMs ?? this.thresholdMs;
    const cancellable = options.cancellable ?? true;
    const showNotification = options.showNotification ?? true;

    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const task: BackgroundTask<T> = {
      id: taskId,
      name,
      status: 'pending',
      startedAt: Date.now(),
      cancellable,
    };

    if (cancellable) {
      task.cancelToken = new vscode.CancellationTokenSource();
    }

    this.tasks.set(taskId, task);
    logger.info(`Задача "${name}" запущена (ID: ${taskId})`, 'BackgroundTaskManager');

    try {
      // Запускаем задачу с таймаутом для показа прогресса
      const result = await this.executeWithProgress(task, fn, threshold);

      task.status = 'completed';
      task.completedAt = Date.now();
      task.result = result;

      const duration = task.completedAt - task.startedAt;
      logger.info(`Задача "${name}" завершена за ${duration}мс`, 'BackgroundTaskManager');

      // Уведомление о завершении (если задача была длительной)
      if (showNotification && duration > threshold) {
        vscode.window.showInformationMessage(`✅ ${name} завершена (${this.formatDuration(duration)})`);
      }

      return result;
    } catch (error) {
      task.status = 'failed';
      task.completedAt = Date.now();
      task.error = error instanceof Error ? error : new Error(String(error));

      logger.error(`Задача "${name}" завершилась с ошибкой`, task.error, 'BackgroundTaskManager');

      if (showNotification) {
        vscode.window.showErrorMessage(`❌ ${name} завершилась с ошибкой: ${task.error.message}`);
      }

      throw task.error;
    } finally {
      // Очищаем cancel token
      if (task.cancelToken) {
        task.cancelToken.dispose();
      }
    }
  }

  /**
   * Выполняет задачу с показом прогресса, если она длится дольше порога.
   */
  private async executeWithProgress<T>(
    task: BackgroundTask<T>,
    fn: (cancellationToken?: vscode.CancellationToken) => Promise<T>,
    thresholdMs: number
  ): Promise<T> {
    let progressDisposable: vscode.Disposable | undefined;

    // Таймер для показа прогресса
    const progressTimer = setTimeout(() => {
      task.status = 'running';

      // Показываем прогресс в VS Code
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: ` ${task.name}`,
          cancellable: task.cancellable,
        },
        (progress, token) => {
          return new Promise<void>((resolve) => {
            // Обновляем сообщение каждые 5 секунд
            let elapsed = 0;
            const updateInterval = setInterval(() => {
              elapsed += 5;
              progress.report({
                message: `В обработке... ${elapsed} сек`,
              });

              // Проверяем отмену
              if (token.isCancellationRequested) {
                clearInterval(updateInterval);
                if (task.cancelToken) {
                  task.cancelToken.cancel();
                }
                task.status = 'cancelled';
                resolve();
              }
            }, 5000);

            // Ждём завершения задачи извне
            const checkCompletion = setInterval(() => {
              if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
                clearInterval(updateInterval);
                clearInterval(checkCompletion);
                resolve();
              }
            }, 100);
          });
        }
      ).then(() => {
        if (progressDisposable) {
          progressDisposable.dispose();
        }
      });

      progressDisposable = { dispose: () => clearTimeout(progressTimer) };
    }, thresholdMs);

    try {
      // Выполняем задачу
      const result = await fn(task.cancelToken?.token);

      // Очищаем таймер прогресса
      clearTimeout(progressTimer);
      if (progressDisposable) {
        progressDisposable.dispose();
      }

      return result;
    } catch (error) {
      clearTimeout(progressTimer);
      if (progressDisposable) {
        progressDisposable.dispose();
      }
      throw error;
    }
  }

  /**
   * Отменяет задачу по ID.
   */
  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || !task.cancellable || !task.cancelToken) {
      return false;
    }

    task.cancelToken.cancel();
    task.status = 'cancelled';
    task.completedAt = Date.now();

    logger.info(`Задача "${task.name}" отменена`, 'BackgroundTaskManager');
    return true;
  }

  /**
   * Получает информацию о задаче.
   */
  getTask(taskId: string): BackgroundTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Получает все активные задачи.
   */
  getActiveTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values()).filter(
      (t) => t.status === 'pending' || t.status === 'running'
    );
  }

  /**
   * Форматирует длительность в читаемый вид.
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}мс`;
    }
    if (ms < 60000) {
      return `${(ms / 1000).toFixed(1)}сек`;
    }
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}мин ${seconds}сек`;
  }

  /**
   * Освобождает ресурсы.
   */
  dispose(): void {
    // Отменяем все активные задачи
    for (const task of this.tasks.values()) {
      if (task.cancelToken && task.status === 'running') {
        task.cancelToken.cancel();
      }
    }
    this.tasks.clear();
    logger.info('BackgroundTaskManager остановлен', 'BackgroundTaskManager');
  }
}
