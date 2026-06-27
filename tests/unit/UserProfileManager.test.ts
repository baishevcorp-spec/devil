import { UserProfileManager } from '../../src/services/UserProfileManager';
import { MemoryStore } from '../../src/services/MemoryStore';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('UserProfileManager', () => {
  let userProfileManager: UserProfileManager;
  let memoryStore: MemoryStore;
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devil-profile-test-'));
    memoryStore = new MemoryStore();
    await memoryStore.initialize(testDir);
    userProfileManager = new UserProfileManager(memoryStore);
  });

  afterEach(async () => {
    await memoryStore.close();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('getProfile', () => {
    it('возвращает профиль по умолчанию', async () => {
      const profile = await userProfileManager.getProfile();
      expect(profile.codingStyle.indentStyle).toBe('spaces');
      expect(profile.codingStyle.indentSize).toBe(2);
    });
  });

  describe('updateProfile', () => {
    it('обновляет стиль кода', async () => {
      await userProfileManager.updateProfile({
        codingStyle: {
          indentStyle: 'tabs',
          indentSize: 4,
          quoteStyle: 'double',
          semicolons: false
        }
      });

      const profile = await userProfileManager.getProfile();
      expect(profile.codingStyle.indentStyle).toBe('tabs');
      expect(profile.codingStyle.indentSize).toBe(4);
    });

    it('обновляет предпочтения', async () => {
      await userProfileManager.updateProfile({
        preferredLibraries: ['React', 'TypeScript'],
        preferredPatterns: ['Functional components', 'Hooks']
      });

      const profile = await userProfileManager.getProfile();
      expect(profile.preferredLibraries).toContain('React');
      expect(profile.preferredPatterns).toContain('Hooks');
    });
  });

  describe('addPreference', () => {
    it('добавляет библиотеку', async () => {
      await userProfileManager.addPreference('library', 'Vue');
      
      const profile = await userProfileManager.getProfile();
      expect(profile.preferredLibraries).toContain('Vue');
    });

    it('не добавляет дубликаты', async () => {
      await userProfileManager.addPreference('library', 'React');
      await userProfileManager.addPreference('library', 'React');
      
      const profile = await userProfileManager.getProfile();
      const count = profile.preferredLibraries.filter((lib: string) => lib === 'React').length;
      expect(count).toBe(1);
    });
  });

  describe('getPreferences', () => {
    it('возвращает все предпочтения', async () => {
      await userProfileManager.addPreference('library', 'Angular');
      await userProfileManager.addPreference('pattern', 'MVC');
      
      const prefs = await userProfileManager.getPreferences();
      expect(prefs.libraries).toContain('Angular');
      expect(prefs.patterns).toContain('MVC');
    });
  });

  describe('persistency', () => {
    it('сохраняет данные между сессиями', async () => {
      await userProfileManager.updateProfile({
        preferredLibraries: ['Svelte']
      });
      await memoryStore.close();

      const newStore = new MemoryStore();
      await newStore.initialize(testDir);
      
      const newManager = new UserProfileManager(newStore);
      const profile = await newManager.getProfile();
      expect(profile.preferredLibraries).toContain('Svelte');

      await newStore.close();
    });
  });
});
