import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

export interface GitCommit {
  hash: string;
  author: string;
  date: string;
  message: string;
  filesChanged: string[];
}

export class GitService {
  private projectPath: string = '';

  constructor(projectPath?: string) {
    if (projectPath) {
      this.projectPath = projectPath;
    }
  }

  setProjectPath(projectPath: string): void {
    this.projectPath = projectPath;
  }

  async getCurrentBranch(): Promise<string> {
    try {
      const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.projectPath
      });
      return stdout.trim();
    } catch (error) {
      logger.error('Ошибка получения текущей ветки', error, 'GitService');
      return 'unknown';
    }
  }

  async getLog(filePath?: string, limit: number = 20): Promise<GitCommit[]> {
    try {
      const filePathArg = filePath ? ` -- "${filePath}"` : '';
      const { stdout } = await execAsync(
        `git log --pretty=format:"%H|%an|%ad|%s" --date=short${filePathArg} -n ${limit}`,
        { cwd: this.projectPath }
      );

      if (!stdout.trim()) return [];

      return stdout.split('\n').map(line => {
        const [hash, author, date, ...messageParts] = line.split('|');
        return {
          hash: hash || '',
          author: author || '',
          date: date || '',
          message: messageParts.join('|') || '',
          filesChanged: []
        };
      });
    } catch (error) {
      logger.error('Ошибка получения лога Git', error, 'GitService');
      return [];
    }
  }

  async getDiff(commitA: string, commitB: string): Promise<string> {
    try {
      const { stdout } = await execAsync(
        `git diff ${commitA} ${commitB}`,
        { cwd: this.projectPath }
      );
      return stdout;
    } catch (error) {
      logger.error('Ошибка получения diff', error, 'GitService');
      return '';
    }
  }

  async getFileHistory(filePath: string): Promise<GitCommit[]> {
    return await this.getLog(filePath, 50);
  }

  async isGitRepository(): Promise<boolean> {
    try {
      await execAsync('git rev-parse --is-inside-work-tree', {
        cwd: this.projectPath
      });
      return true;
    } catch {
      return false;
    }
  }
}
