import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

/**
 * DreamLockManager — управление файловой блокировкой для Dream
 * Предотвращает параллельный запуск Dream
 */
export class DreamLockManager {
  private lockPath: string;
  private maxAgeMs: number = 3600000; // 1 час

  constructor(devilPath: string) {
    this.lockPath = path.join(devilPath, '.dream.lock');
  }

  /**
   * Попытка получить блокировку
   * @returns true если блокировка получена, false если уже заблокировано
   */
  async acquireLock(): Promise<boolean> {
    try {
      // Проверяем существующую блокировку
      if (await this.isLocked()) {
        // Проверяем, не устарела ли блокировка
        const isStale = await this.isStale();
        if (isStale) {
          logger.warn('Обнаружена устаревшая блокировка, принудительное удаление', 'DreamLockManager');
          await this.forceRelease();
        } else {
          logger.info('Dream уже выполняется, пропуск запуска', 'DreamLockManager');
          return false;
        }
      }

      // Создаём блокировку
      const lockData = {
        pid: process.pid,
        startedAt: Date.now(),
      };

      fs.writeFileSync(this.lockPath, JSON.stringify(lockData, null, 2), 'utf-8');
      logger.info('Блокировка Dream создана', 'DreamLockManager');
      return true;
    } catch (error) {
      logger.error('Ошибка создания блокировки', error, 'DreamLockManager');
      return false;
    }
  }

  /**
   * Освобождение блокировки
   */
  async releaseLock(): Promise<void> {
    try {
      if (fs.existsSync(this.lockPath)) {
        fs.unlinkSync(this.lockPath);
        logger.info('Блокировка Dream удалена', 'DreamLockManager');
      }
    } catch (error) {
      logger.error('Ошибка удаления блокировки', error, 'DreamLockManager');
    }
  }

  /**
   * Проверка наличия блокировки
   */
  async isLocked(): Promise<boolean> {
    return fs.existsSync(this.lockPath);
  }

  /**
   * Проверка, устарела ли блокировка
   */
  private async isStale(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.lockPath)) {
        return false;
      }

      const lockData = JSON.parse(fs.readFileSync(this.lockPath, 'utf-8'));
      const age = Date.now() - lockData.startedAt;
      return age > this.maxAgeMs;
    } catch (error) {
      logger.error('Ошибка проверки устаревания блокировки', error, 'DreamLockManager');
      return true; // Если не можем прочитать, считаем устаревшей
    }
  }

  /**
   * Принудительное удаление блокировки
   */
  private async forceRelease(): Promise<void> {
    try {
      if (fs.existsSync(this.lockPath)) {
        fs.unlinkSync(this.lockPath);
        logger.warn('Блокировка принудительно удалена', 'DreamLockManager');
      }
    } catch (error) {
      logger.error('Ошибка принудительного удаления блокировки', error, 'DreamLockManager');
    }
  }
}
