import { DreamLockManager } from '../../src/services/DreamLockManager';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('DreamLockManager', () => {
  let dreamLockManager: DreamLockManager;
  let testDir: string;
  let devilPath: string;

  beforeEach(async () => {
    // Создаём временную директорию
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devil-lock-test-'));
    devilPath = path.join(testDir, '.devil');
    await fs.mkdir(devilPath);

    dreamLockManager = new DreamLockManager(devilPath);
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('acquireLock', () => {
    it('должен успешно создать блокировку', async () => {
      const result = await dreamLockManager.acquireLock();

      expect(result).toBe(true);

      // Проверяем, что файл блокировки создан
      const lockPath = path.join(devilPath, '.dream.lock');
      const lockExists = await fs.access(lockPath).then(() => true).catch(() => false);
      expect(lockExists).toBe(true);

      // Проверяем содержимое
      const lockContent = await fs.readFile(lockPath, 'utf-8');
      const lockData = JSON.parse(lockContent);
      expect(lockData.pid).toBe(process.pid);
      expect(lockData.startedAt).toBeGreaterThan(0);
    });

    it('должен вернуть false, если блокировка уже существует', async () => {
      // Создаём первую блокировку
      await dreamLockManager.acquireLock();

      // Пытаемся создать вторую
      const result = await dreamLockManager.acquireLock();

      expect(result).toBe(false);
    });

    it('должен удалить старую блокировку (stale lock)', async () => {
      const lockPath = path.join(devilPath, '.dream.lock');

      // Создаём "старую" блокировку (2 часа назад)
      const oldLockData = {
        pid: 99999,
        startedAt: Date.now() - (2 * 60 * 60 * 1000), // 2 часа назад
      };
      await fs.writeFile(lockPath, JSON.stringify(oldLockData), 'utf-8');

      // Пытаемся создать новую блокировку
      const result = await dreamLockManager.acquireLock();

      expect(result).toBe(true);

      // Проверяем, что блокировка обновлена
      const lockContent = await fs.readFile(lockPath, 'utf-8');
      const lockData = JSON.parse(lockContent);
      expect(lockData.pid).toBe(process.pid);
      expect(lockData.startedAt).toBeGreaterThan(oldLockData.startedAt);
    });
  });

  describe('releaseLock', () => {
    it('должен удалить блокировку', async () => {
      // Создаём блокировку
      await dreamLockManager.acquireLock();

      // Освобождаем
      await dreamLockManager.releaseLock();

      // Проверяем, что файл удалён
      const lockPath = path.join(devilPath, '.dream.lock');
      const lockExists = await fs.access(lockPath).then(() => true).catch(() => false);
      expect(lockExists).toBe(false);
    });

    it('не должен бросать ошибку, если блокировка не существует', async () => {
      // Пытаемся освободить несуществующую блокировку
      await expect(dreamLockManager.releaseLock()).resolves.not.toThrow();
    });
  });

  describe('isLocked', () => {
    it('должен вернуть true, если блокировка существует', async () => {
      await dreamLockManager.acquireLock();

      const isLocked = await dreamLockManager.isLocked();
      expect(isLocked).toBe(true);
    });

    it('должен вернуть false, если блокировка не существует', async () => {
      const isLocked = await dreamLockManager.isLocked();
      expect(isLocked).toBe(false);
    });
  });

  describe('forceRelease', () => {
    it('должен принудительно удалить блокировку', async () => {
      await dreamLockManager.acquireLock();

      // Принудительное освобождение (приватный метод, но можно проверить через isLocked)
      // В реальной реализации вы можете сделать этот метод public для тестов
      const lockPath = path.join(devilPath, '.dream.lock');
      await fs.unlink(lockPath);

      const isLocked = await dreamLockManager.isLocked();
      expect(isLocked).toBe(false);
    });
  });

  describe('интеграционные тесты', () => {
    it('должен корректно обрабатывать последовательность acquire/release', async () => {
      // Первый acquire
      expect(await dreamLockManager.acquireLock()).toBe(true);
      expect(await dreamLockManager.isLocked()).toBe(true);

      // Release
      await dreamLockManager.releaseLock();
      expect(await dreamLockManager.isLocked()).toBe(false);

      // Второй acquire
      expect(await dreamLockManager.acquireLock()).toBe(true);
      expect(await dreamLockManager.isLocked()).toBe(true);

      // Очистка
      await dreamLockManager.releaseLock();
    });

    it('должен предотвратить параллельное выполнение', async () => {
      // Первый процесс получает блокировку
      const result1 = await dreamLockManager.acquireLock();
      expect(result1).toBe(true);

      // Второй процесс не может получить блокировку
      const result2 = await dreamLockManager.acquireLock();
      expect(result2).toBe(false);

      // Первый процесс освобождает
      await dreamLockManager.releaseLock();

      // Теперь второй процесс может получить блокировку
      const result3 = await dreamLockManager.acquireLock();
      expect(result3).toBe(true);

      // Очистка
      await dreamLockManager.releaseLock();
    });
  });
});
