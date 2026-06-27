import { IMemoryStore, UserProfile as DbUserProfile } from '../interfaces/IMemoryStore';
import { IUserProfileManager, UserProfile } from '../interfaces/IUserProfileManager';
import { logger } from '../utils/logger';

/**
 * UserProfileManager — управление профилем пользователя через MemoryStore.
 *
 * Отвечает за:
 * - Хранение глобального профиля пользователя (singleton)
 * - Запись предпочтений (стиль кода, библиотеки, паттерны)
 * - Чтение профиля для контекста LLM
 *
 * Все данные хранятся в .devil/memory.db (таблица user_profile, id=1).
 */
export class UserProfileManager implements IUserProfileManager {
  constructor(private readonly memoryStore: IMemoryStore) {
    logger.info('UserProfileManager инициализирован (через MemoryStore)', 'UserProfileManager');
  }

  /**
   * Получает профиль пользователя.
   */
  async getProfile(): Promise<UserProfile> {
    const dbProfile = await this.memoryStore.getUserProfile();

    if (!dbProfile) {
      logger.warn('Профиль не найден, возвращаю значения по умолчанию', 'UserProfileManager');
      return this.getDefaultProfile();
    }

    return this.mapDbProfileToUserProfile(dbProfile);
  }

  /**
   * Обновляет профиль пользователя.
   */
  async updateProfile(updates: Partial<UserProfile>): Promise<void> {
    try {
      await this.memoryStore.updateUserProfile(this.mapUpdates(updates));
      logger.info('Профиль обновлён', 'UserProfileManager');
    } catch (error) {
      logger.error('Не удалось обновить профиль', error, 'UserProfileManager');
    }
  }

  /**
   * Добавляет предпочтение.
   */
  async addPreference(key: string, value: string): Promise<void> {
    try {
      const profile = await this.getProfile();

      if (key === 'library' && !profile.preferredLibraries.includes(value)) {
        profile.preferredLibraries.push(value);
      } else if (key === 'pattern' && !profile.preferredPatterns.includes(value)) {
        profile.preferredPatterns.push(value);
      } else if (key === 'instruction' && !profile.customInstructions.includes(value)) {
        profile.customInstructions.push(value);
      }

      await this.updateProfile(profile);
    } catch (error) {
      logger.error('Не удалось добавить предпочтение', error, 'UserProfileManager');
    }
  }

  /**
   * Получает все предпочтения.
   */
  async getPreferences(): Promise<Record<string, string[]>> {
    const profile = await this.getProfile();

    return {
      libraries: profile.preferredLibraries,
      patterns: profile.preferredPatterns,
      instructions: profile.customInstructions,
    };
  }

  /**
   * Добавляет запись о взаимодействии.
   */
  async addInteraction(record: {
    timestamp: number;
    action: string;
    details: string;
  }): Promise<void> {
    try {
      const profile = await this.getProfile();
      profile.interactionHistory.push(record);

      // Ограничиваем историю последними 100 записями
      if (profile.interactionHistory.length > 100) {
        profile.interactionHistory = profile.interactionHistory.slice(-100);
      }

      await this.updateProfile(profile);
      logger.info('Взаимодействие добавлено: ' + record.action, 'UserProfileManager');
    } catch (error) {
      logger.error('Не удалось добавить взаимодействие', error, 'UserProfileManager');
    }
  }

  /**
   * Получает последние взаимодействия.
   */
  async getRecentInteractions(
    limit: number = 10
  ): Promise<Array<{ timestamp: number; action: string; details: string }>> {
    const profile = await this.getProfile();
    return profile.interactionHistory.slice(-limit);
  }

  /**
   * Преобразует профиль из БД в формат IUserProfileManager.
   */
  private mapDbProfileToUserProfile(dbProfile: DbUserProfile): UserProfile {
    const defaultCodingStyle = {
      indentStyle: 'spaces',
      indentSize: 2,
      quoteStyle: 'single',
      semicolons: true
    };

    return {
      codingStyle: { ...defaultCodingStyle, ...(dbProfile.coding_style as Record<string, unknown>) },
      preferredLibraries: dbProfile.preferred_libraries || [],
      preferredPatterns: dbProfile.preferred_patterns || [],
      customInstructions: dbProfile.custom_instructions || [],
      interactionHistory: []
    };
  }

  /**
   * Преобразует обновления в формат для MemoryStore.
   */
  private mapUpdates(updates: Partial<UserProfile>): Partial<DbUserProfile> {
    const result: Partial<DbUserProfile> = {};

    if (updates.codingStyle !== undefined) {
      result.coding_style = updates.codingStyle;
    }
    if (updates.preferredLibraries !== undefined) {
      result.preferred_libraries = updates.preferredLibraries;
    }
    if (updates.preferredPatterns !== undefined) {
      result.preferred_patterns = updates.preferredPatterns;
    }
    if (updates.customInstructions !== undefined) {
      result.custom_instructions = updates.customInstructions;
    }

    return result;
  }

  /**
   * Возвращает профиль по умолчанию.
   */
  private getDefaultProfile(): UserProfile {
    return {
      codingStyle: {
        indentStyle: 'spaces',
        indentSize: 2,
        quoteStyle: 'single',
        semicolons: true,
      },
      preferredLibraries: [],
      preferredPatterns: [],
      customInstructions: [],
      interactionHistory: [],
    };
  }
}
