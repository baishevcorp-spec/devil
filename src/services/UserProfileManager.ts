import * as fs from 'fs';
import { Database } from 'sql.js';
import {
  IUserProfileManager,
  UserProfile,
  InteractionRecord,
} from '../interfaces/IUserProfileManager';
import { logger } from '../utils/logger';

const DEFAULT_PROFILE: UserProfile = {
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

export class UserProfileManager implements IUserProfileManager {
  private db: Database | null = null;
  private dbPath: string = '';

  async initialize(dbPath: string): Promise<void> {
    this.dbPath = dbPath;

    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    if (fs.existsSync(dbPath)) {
      const buffer = fs.readFileSync(dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    this.createTables();
    this.save();

    logger.info('UserProfileManager инициализирован', 'UserProfileManager');
  }

  private createTables(): void {
    if (!this.db) return;

    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        coding_style TEXT DEFAULT '{}',
        preferred_libraries TEXT DEFAULT '[]',
        preferred_patterns TEXT DEFAULT '[]',
        custom_instructions TEXT DEFAULT '[]',
        updated_at INTEGER NOT NULL
      )
    `);

    // Проверяем, есть ли профиль, если нет — создаём
    const result = this.db.exec('SELECT id FROM user_profile WHERE id = 1');
    if (result.length === 0 || result[0].values.length === 0) {
      this.db.run(
        'INSERT INTO user_profile (id, coding_style, preferred_libraries, preferred_patterns, custom_instructions, updated_at) VALUES (1, ?, ?, ?, ?, ?)',
        [
          JSON.stringify(DEFAULT_PROFILE.codingStyle),
          JSON.stringify(DEFAULT_PROFILE.preferredLibraries),
          JSON.stringify(DEFAULT_PROFILE.preferredPatterns),
          JSON.stringify(DEFAULT_PROFILE.customInstructions),
          Date.now(),
        ]
      );
    }
  }

  private save(): void {
    if (!this.db) return;

    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    } catch (error) {
      logger.error('Не удалось сохранить профиль', error, 'UserProfileManager');
    }
  }

  async getProfile(): Promise<UserProfile> {
    if (!this.db) throw new Error('UserProfileManager не инициализирован');

    const result = this.db.exec('SELECT * FROM user_profile WHERE id = 1');

    if (result.length === 0 || result[0].values.length === 0) {
      return DEFAULT_PROFILE;
    }

    const columns = result[0].columns;
    const row = result[0].values[0];

    return {
      codingStyle: JSON.parse(row[columns.indexOf('coding_style')] as string),
      preferredLibraries: JSON.parse(row[columns.indexOf('preferred_libraries')] as string),
      preferredPatterns: JSON.parse(row[columns.indexOf('preferred_patterns')] as string),
      customInstructions: JSON.parse(row[columns.indexOf('custom_instructions')] as string),
      interactionHistory: [], // История хранится отдельно
    };
  }

  async updateProfile(updates: Partial<UserProfile>): Promise<void> {
    if (!this.db) throw new Error('UserProfileManager не инициализирован');

    const current = await this.getProfile();
    const updated = { ...current, ...updates };

    this.db.run(
      'UPDATE user_profile SET coding_style = ?, preferred_libraries = ?, preferred_patterns = ?, custom_instructions = ?, updated_at = ? WHERE id = 1',
      [
        JSON.stringify(updated.codingStyle),
        JSON.stringify(updated.preferredLibraries),
        JSON.stringify(updated.preferredPatterns),
        JSON.stringify(updated.customInstructions),
        Date.now(),
      ]
    );

    this.save();
    logger.info('Профиль обновлён', 'UserProfileManager');
  }

  async addPreference(key: string, value: string): Promise<void> {
    const profile = await this.getProfile();

    if (key === 'library' && !profile.preferredLibraries.includes(value)) {
      profile.preferredLibraries.push(value);
    } else if (key === 'pattern' && !profile.preferredPatterns.includes(value)) {
      profile.preferredPatterns.push(value);
    } else if (key === 'instruction' && !profile.customInstructions.includes(value)) {
      profile.customInstructions.push(value);
    }

    await this.updateProfile(profile);
  }

  async getPreferences(): Promise<Record<string, string[]>> {
    const profile = await this.getProfile();

    return {
      libraries: profile.preferredLibraries,
      patterns: profile.preferredPatterns,
      instructions: profile.customInstructions,
    };
  }

  async addInteraction(record: InteractionRecord): Promise<void> {
    // История взаимодействий хранится в памяти (можно расширить для хранения в БД)
    const profile = await this.getProfile();
    profile.interactionHistory.push(record);

    // Ограничиваем историю последними 100 записями
    if (profile.interactionHistory.length > 100) {
      profile.interactionHistory = profile.interactionHistory.slice(-100);
    }

    // Сохраняем в отдельную таблицу или файл (упрощённо — в памяти)
    logger.info('Взаимодействие добавлено: ' + record.action, 'UserProfileManager');
  }

  async getRecentInteractions(): Promise<InteractionRecord[]> {
    // Упрощённая реализация — возвращаем пустой массив
    // В полной версии можно хранить в отдельной таблице
    return [];
  }

  async close(): Promise<void> {
    if (this.db) {
      this.save();
      this.db.close();
      this.db = null;
      logger.info('UserProfileManager закрыт', 'UserProfileManager');
    }
  }
}
