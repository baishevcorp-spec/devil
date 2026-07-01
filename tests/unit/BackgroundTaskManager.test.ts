import { BackgroundTaskManager } from '../../src/services/BackgroundTaskManager';

describe('BackgroundTaskManager', () => {
  let taskManager: BackgroundTaskManager;

  beforeEach(() => {
    taskManager = new BackgroundTaskManager(100); // Короткий порог для тестов
  });

  afterEach(() => {
    taskManager.dispose();
  });

  it('выполняет быструю задачу без прогресса', async () => {
    const result = await taskManager.run(
      'Быстрая задача',
      async () => 'результат',
      { showNotification: false }
    );

    expect(result).toBe('результат');
  });

  it('выполняет медленную задачу с прогрессом', async () => {
    const result = await taskManager.run(
      'Медленная задача',
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'медленный результат';
      },
      { thresholdMs: 50, showNotification: false }
    );

    expect(result).toBe('медленный результат');
  });

  it('отменяет задачу', async () => {
    const taskPromise = taskManager.run(
      'Отменяемая задача',
      async (token) => {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 1000);
          token?.onCancellationRequested(() => {
            clearTimeout(timer);
            reject(new Error('Отменено'));
          });
        });
        return 'результат';
      },
      { cancellable: true, showNotification: false }
    );

    // Отменяем через 50мс
    setTimeout(() => {
      const tasks = taskManager.getActiveTasks();
      if (tasks.length > 0) {
        taskManager.cancelTask(tasks[0].id);
      }
    }, 50);

    await expect(taskPromise).rejects.toThrow('Отменено');
  });

  it('возвращает активные задачи', async () => {
    const taskPromise = taskManager.run(
      'Долгая задача',
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return 'результат';
      },
      { thresholdMs: 50, showNotification: false }
    );

    // Ждём 100мс
    await new Promise((resolve) => setTimeout(resolve, 100));

    const activeTasks = taskManager.getActiveTasks();
    expect(activeTasks.length).toBeGreaterThan(0);

    await taskPromise;
  });

  it('обрабатывает ошибки задачи', async () => {
    await expect(
      taskManager.run(
        'Ошибка',
        async () => {
          throw new Error('Тестовая ошибка');
        },
        { showNotification: false }
      )
    ).rejects.toThrow('Тестовая ошибка');
  });
});
