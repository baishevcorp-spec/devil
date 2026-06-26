import { GitService } from '../../src/services/GitService';

jest.mock('child_process', () => ({
  exec: jest.fn()
}));

const { exec } = require('child_process');

describe('GitService', () => {
  let gitService: GitService;

  beforeEach(() => {
    gitService = new GitService('/test/project');
    jest.clearAllMocks();
  });

  describe('getCurrentBranch', () => {
    it('возвращает имя текущей ветки', async () => {
      exec.mockImplementation((_cmd: string, _options: any, callback: Function) => {
        callback(null, { stdout: 'main\n', stderr: '' });
      });

      const branch = await gitService.getCurrentBranch();
      expect(branch).toBe('main');
    });

    it('возвращает unknown при ошибке', async () => {
      exec.mockImplementation((_cmd: string, _options: any, callback: Function) => {
        callback(new Error('Not a git repo'), null);
      });

      const branch = await gitService.getCurrentBranch();
      expect(branch).toBe('unknown');
    });
  });

  describe('getLog', () => {
    it('возвращает список коммитов', async () => {
      const mockLog = 'abc123|John Doe|2024-01-15|Initial commit\ndef456|Jane Smith|2024-01-16|Add feature';
      
      exec.mockImplementation((_cmd: string, _options: any, callback: Function) => {
        callback(null, { stdout: mockLog, stderr: '' });
      });

      const commits = await gitService.getLog();
      expect(commits.length).toBe(2);
      expect(commits[0].hash).toBe('abc123');
      expect(commits[0].author).toBe('John Doe');
      expect(commits[1].message).toBe('Add feature');
    });

    it('возвращает пустой массив при отсутствии коммитов', async () => {
      exec.mockImplementation((_cmd: string, _options: any, callback: Function) => {
        callback(null, { stdout: '', stderr: '' });
      });

      const commits = await gitService.getLog();
      expect(commits.length).toBe(0);
    });

    it('передаёт filePath в команду git', async () => {
      exec.mockImplementation((_cmd: string, _options: any, callback: Function) => {
        callback(null, { stdout: '', stderr: '' });
      });

      await gitService.getLog('src/test.ts');
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('-- "src/test.ts"'),
        expect.any(Object),
        expect.any(Function)
      );
    });
  });

  describe('getDiff', () => {
    it('возвращает diff между коммитами', async () => {
      const mockDiff = 'diff --git a/file.ts b/file.ts\n+new line';
      
      exec.mockImplementation((_cmd: string, _options: any, callback: Function) => {
        callback(null, { stdout: mockDiff, stderr: '' });
      });

      const diff = await gitService.getDiff('abc123', 'def456');
      expect(diff).toContain('diff --git');
      expect(diff).toContain('+new line');
    });

    it('возвращает пустую строку при ошибке', async () => {
      exec.mockImplementation((_cmd: string, _options: any, callback: Function) => {
        callback(new Error('Invalid commit'), null);
      });

      const diff = await gitService.getDiff('invalid1', 'invalid2');
      expect(diff).toBe('');
    });
  });

  describe('isGitRepository', () => {
    it('возвращает true для git-репозитория', async () => {
      exec.mockImplementation((_cmd: string, _options: any, callback: Function) => {
        callback(null, { stdout: 'true\n', stderr: '' });
      });

      const isRepo = await gitService.isGitRepository();
      expect(isRepo).toBe(true);
    });

    it('возвращает false для не-git директории', async () => {
      exec.mockImplementation((_cmd: string, _options: any, callback: Function) => {
        callback(new Error('Not a git repo'), null);
      });

      const isRepo = await gitService.isGitRepository();
      expect(isRepo).toBe(false);
    });
  });
});
