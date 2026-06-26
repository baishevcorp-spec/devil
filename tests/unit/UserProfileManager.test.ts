import { UserProfileManager } from '../../src/services/UserProfileManager';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('UserProfileManager', () => {
  let manager: UserProfileManager;
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devil-profile-test-'));
    manager = new UserProfileManager();
    await manager.initialize(path.join(testDir, 'profile.db'));
  });

  afterEach(async () => {
    await manager.close();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('initialize', () => {
    it('создаёт файл БД', async () => {
      const dbPath = path.join(testDir, 'profile.db');
      const exists = await fs.access(dbPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('создаёт профиль по умолчанию', async () => {
      const profile = await manager.getProfile();
      expect(profile.codingStyle.indentStyle).toBe('spaces');
      expect(profile.codingStyle.indentSize).toBe(2);
      expect(profile.codingStyle.quoteStyle).toBe('single');
      expect(profile.codingStyle.semicolons).toBe(true);
    });
  });

  describe('updateProfile', () => {
    it('обновляет стиль кода', async () => {
      await manager.updateProfile({
        codingStyle: {
          indentStyle: 'tabs',
          indentSize: 4,
          quoteStyle: 'double',
          semicolons: false
        }
      });

      const profile = await manager.getProfile();
      expect(profile.codingStyle.indentStyle).toBe('tabs');
      expect(profile.codingStyle.indentSize).toBe(4);
    });

    it('обновляет предпочтения', async () => {
      await manager.updateProfile({
        preferredLibraries: ['React', 'TypeScript'],
        preferredPatterns: ['Functional components', 'Hooks']
      });

      const profile = await manager.getProfile();
      expect(profile.preferredLibraries).toContain('React');
      expect(profile.preferredPatterns).toContain('Hooks');
    });
  });

  describe('addPreference', () => {
    it('добавляет библиотеку', async () => {
      await manager.addPreference('library', 'Vue');

      const profile = await manager.getProfile();
      expect(profile.preferredLibraries).toContain('Vue');
    });

    it('не добавляет дубликаты', async () => {
      await manager.addPreference('library', 'React');
      await manager.addPreference('library', 'React');

      const profile = await manager.getProfile();
      const count = profile.preferredLibraries.filter(lib => lib === 'React').length;
      expect(count).toBe(1);
    });
  });

  describe('getPreferences', () => {
    it('возвращает все предпочтения', async () => {
      await manager.addPreference('library', 'Angular');
      await manager.addPreference('pattern', 'MVC');

      const prefs = await manager.getPreferences();
      expect(prefs.libraries).toContain('Angular');
      expect(prefs.patterns).toContain('MVC');
    });
  });

  describe('persistency', () => {
    it('сохраняет данные между сессиями', async () => {
      await manager.updateProfile({
        preferredLibraries: ['Svelte']
      });
      await manager.close();

      const newManager = new UserProfileManager();
      await newManager.initialize(path.join(testDir, 'profile.db'));

      const profile = await newManager.getProfile();
      expect(profile.preferredLibraries).toContain('Svelte');

      await newManager.close();
    });
  });
});
