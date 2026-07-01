import { logger } from '../utils/logger';
import { ErrorHandler } from '../utils/ErrorHandler';
import { FileSystemService } from '../services/FileSystemService';
import { LLMProvider } from '../services/LLMProvider';
import { ContextBuilder } from '../services/ContextBuilder';
import { IProjectManager } from '../interfaces/IProjectManager';
import { IMemoryStore } from '../interfaces/IMemoryStore';
import { GitService } from '../services/GitService';
import { SearchIndex } from '../services/SearchIndex';
import { GraphBuilder } from '../services/GraphBuilder';
import { IMultiModelManager } from '../interfaces/IMultiModelManager';
import * as child_process from 'child_process';
import * as util from 'util';
import * as path from 'path';
import { InterviewData, InterviewStatusData, validateInterview } from '../interfaces/IInterview';
import { RoadmapParser } from '../utils/RoadmapParser';
import { ChecklistSync } from '../utils/ChecklistSync';
import { DevPlanManager } from '../services/DevPlanManager';
import { DevPlanExecutor } from '../services/DevPlanExecutor';

export interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

interface ProjectAnalysis {
  totalFiles: number;
  hasPackageJson: boolean;
  hasTsConfig: boolean;
  hasGitignore: boolean;
  hasReadme: boolean;
  technology: string;
  projectStructure: unknown;
  projectPath: string;
}

export class CommandHandler {
  // Константы для файлов
  private readonly INTERVIEW_FILENAME = 'interview.json';
  private readonly ROADMAP_FILENAME = 'roadmap.md';

  constructor(
    private readonly fileSystemService: FileSystemService,
    private readonly llmProvider: LLMProvider,
    private readonly contextBuilder: ContextBuilder,
    private readonly projectManager: IProjectManager,
    private readonly memoryStore: IMemoryStore,
    private readonly gitService: GitService,
    private readonly searchIndex: SearchIndex,
    private readonly graphBuilder?: GraphBuilder,
    private readonly multiModelManager?: IMultiModelManager,
    private readonly devPlanManager?: DevPlanManager,
    private readonly devPlanExecutor?: DevPlanExecutor
  ) {
    logger.info('CommandHandler инициализирован', 'CommandHandler');
  }

  private async safeExecute<T>(
    operation: () => Promise<T>,
    context: string
  ): Promise<CommandResult> {
    try {
      const result = await operation();
      return {
        success: true,
        message: typeof result === 'string' ? result : JSON.stringify(result),
        data: result,
      };
    } catch (error) {
      const errorHandler = ErrorHandler.getInstance();
      const devilError = errorHandler.classifyError(error);

      logger.error(
        'Error in ' + context,
        {
          error: devilError.message,
          type: devilError.type,
          details: devilError.details,
        },
        'CommandHandler'
      );

      return {
        success: false,
        message: devilError.userMessage,
        data: { errorType: devilError.type },
      };
    }
  }

  async handleMessage(message: string): Promise<CommandResult | null> {
    const trimmed = message.trim();

    if (!trimmed.startsWith('/')) {
      return null;
    }

    const separatorIndex = trimmed.indexOf(' --- ');
    let commandPart: string;
    let selectedCode: string | null = null;

    if (separatorIndex !== -1) {
      commandPart = trimmed.substring(0, separatorIndex).trim();
      selectedCode = trimmed.substring(separatorIndex + 5).trim();
    } else {
      commandPart = trimmed;
    }

    const parts = commandPart.split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    logger.info('Обработка команды: ' + command + ' (args: ' + args.length + ')', 'CommandHandler');

    switch (command) {
      case '/scan':
        return await this.handleScan(args, selectedCode);
      case '/roadmap':
        if (args.length > 0 && args[0] === 'update') {
          return await this.handleRoadmapUpdate();
        }
        return await this.handleRoadmap(args);
      case '/checklist':
        if (args.length > 0 && args[0] === 'sync') {
          return await this.handleChecklistSync();
        }
        return await this.handleChecklist(args);
      case '/explain':
        return await this.handleExplain(args, selectedCode);
      case '/search':
        return await this.handleSearch(args);
      case '/whereis':
        return await this.handleWhereis(args);
      case '/diff':
        return await this.handleDiff(args);
      case '/git':
        return await this.handleGit(args);
      case '/memory':
        return await this.handleMemory(args);
      case '/rebuild':
        return await this.handleRebuild([]);
      case '/model':
        return await this.handleModel(args);
      case '/view':
        return await this.handleView(args);
      case '/lint':
        return await this.handleLint(args);
      case '/refactor':
        return await this.handleRefactor(args, selectedCode);
      case '/test':
        return await this.handleTestGenerate(args, selectedCode);
      case '/dev':
        if (args.length === 0) {
          return {
            success: false,
            message:
              'Использование:\n' +
              '- `/dev generate` — сгенерировать план разработки\n' +
              '- `/dev next` — выполнить следующий шаг\n' +
              '- `/dev status` — показать прогресс\n' +
              '- `/dev skip [id]` — пропустить шаг\n' +
              '- `/dev reset` — сбросить план',
          };
        }

        switch (args[0]) {
          case 'generate':
            return await this.handleDevGenerate();
          case 'next':
            return await this.handleDevNext();
          case 'status':
            return await this.handleDevStatus();
          case 'skip':
            return await this.handleDevSkip(args);
          case 'reset':
            return await this.handleDevReset();
          default:
            return {
              success: false,
              message: `Неизвестная подкоманда: /dev ${args[0]}`,
            };
        }
      case '/help':
        return this.handleHelp();
      default:
        return {
          success: false,
          message:
            'Неизвестная команда: ' + command + '\n\nВведите /help для списка доступных команд.',
        };
    }
  }

  private async handleScan(args: string[], _selectedCode: string | null): Promise<CommandResult> {
    if (args.length === 0) {
      return {
        success: false,
        message: 'Использование: /scan <путь_к_файлу>\n\nПример: /scan src/extension.ts',
      };
    }

    const filePath = args[0];
    const project = this.projectManager.getCurrentProject();

    if (!project) {
      return {
        success: false,
        message: 'Проект не открыт. Используйте команду "Devil: Open Project".',
      };
    }

    const fullPath = project.path + '/' + filePath;

    try {
      const exists = await this.fileSystemService.fileExists(fullPath);
      if (!exists) {
        return {
          success: false,
          message: 'Файл не найден: ' + filePath,
        };
      }

      const content = await this.fileSystemService.readFile(fullPath);

      return {
        success: true,
        message:
          '## Содержимое файла: ' +
          filePath +
          '\n\n```' +
          this.getLanguage(filePath) +
          '\n' +
          content +
          '\n```',
        data: { path: filePath, content },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Ошибка чтения файла: ' + errorMessage,
      };
    }
  }

  private async handleRoadmap(args: string[]): Promise<CommandResult> {
    if (args.length === 0 || args[0] !== 'generate') {
      return {
        success: false,
        message:
          'Использование: /roadmap generate\n\nСгенерирует план проекта на основе структуры файлов или проведёт интервью для пустого проекта.',
      };
    }

    const project = this.projectManager.getCurrentProject();
    if (!project) {
      return {
        success: false,
        message: 'Проект не открыт.',
      };
    }

    const interviewPath = path.join(project.devilPath, this.INTERVIEW_FILENAME);
    const roadmapPath = path.join(project.devilPath, this.ROADMAP_FILENAME);

    try {
      // 1. Анализ состояния проекта
      const analysis = await this.analyzeProjectState(project);
      const isProjectEmpty = analysis.totalFiles === 0;

      // 🔍 ОТЛАДКА: логируем путь к интервью
      logger.info('handleRoadmap: interviewPath=' + interviewPath, 'CommandHandler');
      logger.info('handleRoadmap: project.devilPath=' + project.devilPath, 'CommandHandler');
      logger.info('handleRoadmap: INTERVIEW_FILENAME=' + this.INTERVIEW_FILENAME, 'CommandHandler');

      // 2. Проверяем наличие файла интервью
      const hasInterview = await this.fileSystemService.fileExists(interviewPath);

      // 2.5 Проверяем статус интервью
      const interviewStatus = await this.getInterviewStatus(project);

      // 2.6 Проверяем существование roadmap.md
      const roadmapExists = await this.fileSystemService.fileExists(roadmapPath);

      if (roadmapExists && interviewStatus?.status === 'roadmap_generated') {
        return {
          success: false,
          message:
            '📄 Roadmap уже существует (`.devil/roadmap.md`).\n\n' +
            'Если вы хотите перегенерировать его с учётом новых данных, используйте команду:\n' +
            '`/roadmap update`\n\n' +
            'Или удалите существующий файл `.devil/roadmap.md` и выполните `/roadmap generate` снова.',
        };
      }

      // 3. Если проект пустой и интервью нет — запускаем процесс интервью
      if (isProjectEmpty && !hasInterview) {
        return await this.startInterview(project);
      }

      // 4. Если проект пустой, но интервью есть — читаем JSON
      let interviewData: InterviewData | null = null;
      if (isProjectEmpty && hasInterview) {
        const interviewContent = await this.fileSystemService.readFile(interviewPath);
        try {
          const parsed = JSON.parse(interviewContent);
          if (!validateInterview(parsed)) {
            return {
              success: false,
              message:
                '📄 Файл `.devil/interview.json` заполнен некорректно.\n\n' +
                'Убедитесь, что заполнены все обязательные поля:\n' +
                '- projectName (строка)\n' +
                '- description (строка)\n' +
                '- goals (массив строк, минимум 1)\n' +
                '- techStack (массив строк, минимум 1)\n' +
                '- targetAudience (строка)\n' +
                '- deadlines (строка)\n\n' +
                'Откройте файл и заполните поля, затем выполните команду снова.',
            };
          }
          interviewData = parsed;
          // Обновляем статус на 'filled'
          await this.updateInterviewStatus(project, 'filled');
        } catch (parseError) {
          return {
            success: false,
            message:
              '📄 Ошибка чтения `.devil/interview.json`: файл не является валидным JSON.\n\n' +
              'Проверьте синтаксис файла и попробуйте снова.',
          };
        }
      }

      // 5. Если проект непустой, но интервью есть — читаем как доп. контекст
      if (!isProjectEmpty && hasInterview) {
        const interviewContent = await this.fileSystemService.readFile(interviewPath);
        try {
          const parsed = JSON.parse(interviewContent);
          if (validateInterview(parsed)) {
            interviewData = parsed;
          }
        } catch (parseError) {
          // Игнорируем ошибки парсинга для непустого проекта
          logger.warn('Не удалось прочитать interview.json как JSON', 'CommandHandler');
        }
      }

      // 6. Строим контекст и промпт с учётом интервью
      const context = await this.buildRoadmapContext(project, analysis);
      const prompt = this.buildRoadmapPrompt(context, interviewData);

      const response = await this.llmProvider.generate(prompt, {
        systemPrompt: context.systemPrompt,
      });

      // Сохраняем roadmap
      await this.fileSystemService.writeFile(roadmapPath, response.content);

      // Обновляем статус на 'roadmap_generated'
      await this.updateInterviewStatus(project, 'roadmap_generated');

      return {
        success: true,
        message: '✅ Roadmap сгенерирован и сохранён в `.devil/roadmap.md`\n\n' + response.content,
        data: { path: roadmapPath, content: response.content },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Ошибка генерации Roadmap: ' + errorMessage,
      };
    }
  }

  private async handleRoadmapUpdate(): Promise<CommandResult> {
    const project = this.projectManager.getCurrentProject();
    if (!project) {
      return {
        success: false,
        message: 'Проект не открыт.',
      };
    }

    try {
      const roadmapPath = path.join(project.devilPath, 'roadmap.md');
      const interviewPath = path.join(project.devilPath, 'interview.json');

      // 1. Проверяем существование текущего roadmap
      const roadmapExists = await this.fileSystemService.fileExists(roadmapPath);
      if (!roadmapExists) {
        return {
          success: false,
          message:
            '📄 Roadmap не найден (`.devil/roadmap.md`).\n\n' +
            'Сначала выполните команду `/roadmap generate` для создания roadmap.',
        };
      }

      // 2. Проверяем существование interview.json
      const interviewExists = await this.fileSystemService.fileExists(interviewPath);
      if (!interviewExists) {
        return {
          success: false,
          message:
            '📄 Интервью не найдено (`.devil/interview.json`).\n\n' +
            'Сначала выполните команду `/roadmap generate` для создания интервью.',
        };
      }

      // 3. Читаем текущий roadmap
      const currentRoadmap = await this.fileSystemService.readFile(roadmapPath);

      // 4. Определяем номер версии
      const versionNumber = await this.getNextVersionNumber(project.devilPath);
      const backupPath = path.join(project.devilPath, `roadmap_v${versionNumber}.md`);

      // 5. Сохраняем текущую версию как backup
      await this.fileSystemService.writeFile(backupPath, currentRoadmap);
      logger.info(`Сохранена предыдущая версия roadmap: ${backupPath}`, 'CommandHandler');

      // 6. Читаем interview.json
      const interviewContent = await this.fileSystemService.readFile(interviewPath);
      let interviewData: InterviewData | null = null;

      try {
        const parsed = JSON.parse(interviewContent);
        if (validateInterview(parsed)) {
          interviewData = parsed;
        }
      } catch (parseError) {
        logger.warn('Не удалось прочитать interview.json', 'CommandHandler');
      }

      // 7. Строим контекст и промпт
      const analysis = await this.analyzeProjectState(project);
      const context = await this.buildRoadmapContext(project, analysis);
      const prompt = this.buildRoadmapPrompt(context, interviewData);

      // 8. Генерируем новый roadmap
      const response = await this.llmProvider.generate(prompt, {
        systemPrompt: context.systemPrompt,
      });

      // 9. Сохраняем новый roadmap
      await this.fileSystemService.writeFile(roadmapPath, response.content);

      // 10. Обновляем статус интервью
      await this.updateInterviewStatus(project, 'roadmap_generated');

      const message =
        `✅ Roadmap обновлён и сохранён в \`.devil/roadmap.md\`\n\n` +
        `📦 **Предыдущая версия сохранена:** \`${backupPath}\`\n\n` +
        `📊 **Версия:** v${versionNumber + 1}\n\n` +
        response.content;

      return {
        success: true,
        message,
        data: {
          path: roadmapPath,
          content: response.content,
          backupPath,
          version: versionNumber + 1,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Ошибка обновления Roadmap: ' + errorMessage,
      };
    }
  }

  /**
   * Определяет следующий номер версии roadmap.
   */
  private async getNextVersionNumber(devilPath: string): Promise<number> {
    const files = await this.fileSystemService.scanDirectory(devilPath, {
      excludePatterns: [],
    });

    let maxVersion = 0;
    const collectVersions = (node: any) => {
      if (node.type === 'file' && node.name.match(/^roadmap_v\d+\.md$/)) {
        const match = node.name.match(/^roadmap_v(\d+)\.md$/);
        if (match) {
          const version = parseInt(match[1], 10);
          if (version > maxVersion) {
            maxVersion = version;
          }
        }
      }
      if (node.children) {
        node.children.forEach(collectVersions);
      }
    };

    collectVersions(files);
    return maxVersion;
  }

  // ---------- Запуск интервью для пустого проекта ----------
  private async startInterview(project: any): Promise<CommandResult> {
    const interviewPath = path.join(project.devilPath, 'interview.json');
    const statusPath = path.join(project.devilPath, '.interview_status.json');

    try {
      const interviewTemplate: InterviewData = {
        projectName: project.name || '',
        description: '',
        goals: [],
        techStack: [],
        targetAudience: '',
        deadlines: '',
        constraints: [],
        additionalInfo: '',
      };

      const interviewContent = JSON.stringify(interviewTemplate, null, 2);
      await this.fileSystemService.writeFile(interviewPath, interviewContent);

      // Создаём статус-файл
      const statusData: InterviewStatusData = {
        status: 'pending',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        interviewFile: 'interview.json',
      };
      await this.fileSystemService.writeFile(statusPath, JSON.stringify(statusData, null, 2));

      const message =
        '📋 Создано структурированное интервью для вашего проекта.\n\n' +
        '**Файл:** `.devil/interview.json`\n\n' +
        'Пожалуйста, откройте файл и заполните следующие поля:\n\n' +
        '- **projectName**: Название проекта\n' +
        '- **description**: Краткое описание проекта (2-3 предложения)\n' +
        '- **goals**: Цели проекта (массив строк)\n' +
        '- **techStack**: Технологии (массив строк, например: ["React", "TypeScript", "Node.js"])\n' +
        '- **targetAudience**: Целевая аудитория\n' +
        '- **deadlines**: Сроки разработки\n' +
        '- **constraints**: Ограничения (массив строк)\n' +
        '- **additionalInfo**: Дополнительная информация (опционально)\n\n' +
        'После заполнения выполните команду `/roadmap generate` снова для генерации плана проекта.';

      return {
        success: true,
        message,
        data: { path: interviewPath, statusPath },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Ошибка создания интервью: ' + errorMessage,
      };
    }
  }

  private async getInterviewStatus(project: any): Promise<InterviewStatusData | null> {
    const statusPath = path.join(project.devilPath, '.interview_status.json');
    const exists = await this.fileSystemService.fileExists(statusPath);
    if (!exists) return null;

    try {
      const content = await this.fileSystemService.readFile(statusPath);
      return JSON.parse(content) as InterviewStatusData;
    } catch (error) {
      logger.warn('Не удалось прочитать .interview_status.json', 'CommandHandler');
      return null;
    }
  }

  private async updateInterviewStatus(
    project: any,
    status: InterviewStatusData['status']
  ): Promise<void> {
    const statusPath = path.join(project.devilPath, '.interview_status.json');
    const current = await this.getInterviewStatus(project);

    const updated: InterviewStatusData = {
      status,
      createdAt: current?.createdAt || Date.now(),
      updatedAt: Date.now(),
      interviewFile: 'interview.json',
    };

    await this.fileSystemService.writeFile(statusPath, JSON.stringify(updated, null, 2));
    logger.info(`Статус интервью обновлён: ${status}`, 'CommandHandler');
  }

  private async analyzeProjectState(project: {
    path: string;
    structure?: unknown;
  }): Promise<ProjectAnalysis> {
    // Считаем файлы в проекте
    const allFiles = this.countProjectFiles(project.structure as { children?: unknown[] });

    // Проверяем наличие ключевых файлов
    const hasPackageJson = await this.fileSystemService.fileExists(project.path + '/package.json');
    const hasTsConfig = await this.fileSystemService.fileExists(project.path + '/tsconfig.json');
    const hasGitignore = await this.fileSystemService.fileExists(project.path + '/.gitignore');
    const hasReadme = await this.fileSystemService.fileExists(project.path + '/README.md');

    // Определяем технологию
    let technology = 'unknown';
    if (hasTsConfig) {
      technology = 'typescript';
    } else if (hasPackageJson) {
      // Пытаемся определить по package.json
      try {
        const packageContent = await this.fileSystemService.readFile(
          project.path + '/package.json'
        );
        const pkg = JSON.parse(packageContent);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        if (deps.react) technology = 'react';
        else if (deps.vue) technology = 'vue';
        else if (deps.angular) technology = 'angular';
        else if (deps.next) technology = 'nextjs';
        else if (deps['@nestjs/core']) technology = 'nestjs';
        else if (deps.express) technology = 'express';
        else technology = 'javascript';
      } catch {
        technology = 'javascript';
      }
    }

    return {
      totalFiles: allFiles,
      hasPackageJson,
      hasTsConfig,
      hasGitignore,
      hasReadme,
      technology,
      projectStructure: project.structure,
      projectPath: project.path,
    };
  }

  private async buildRoadmapContext(
    _project: { path: string },
    analysis: ProjectAnalysis
  ): Promise<{ systemPrompt: string }> {
    // Определяем, сколько информации включать в контекст
    const includeOptions = {
      includeProjectStructure: analysis.totalFiles > 0,
      includeRoadmap: false,
      includeChecklist: false,
    };

    const userQuery =
      analysis.totalFiles === 0
        ? 'Это новый пустой проект. Нужно создать начальный Roadmap для разработки.'
        : 'Сгенерируй подробный Roadmap для этого проекта';

    return await this.contextBuilder.buildContext(userQuery, includeOptions);
  }

  private buildRoadmapPrompt(context: any, interviewData: InterviewData | null): string {
    let prompt = 'Ты — опытный архитектор программного обеспечения. ';

    if (interviewData) {
      prompt +=
        'Создай детальный план проекта на основе следующей информации:\n\n' +
        '## Информация о проекте\n\n' +
        `**Название:** ${interviewData.projectName}\n\n` +
        `**Описание:** ${interviewData.description}\n\n` +
        `**Цели:**\n${interviewData.goals.map((g) => `- ${g}`).join('\n')}\n\n` +
        `**Технологии:** ${interviewData.techStack.join(', ')}\n\n` +
        `**Целевая аудитория:** ${interviewData.targetAudience}\n\n` +
        `**Сроки:** ${interviewData.deadlines}\n\n`;

      if (interviewData.constraints.length > 0) {
        prompt += `**Ограничения:**\n${interviewData.constraints.map((c) => `- ${c}`).join('\n')}\n\n`;
      }

      if (interviewData.additionalInfo) {
        prompt += `**Дополнительная информация:** ${interviewData.additionalInfo}\n\n`;
      }
    } else {
      prompt += 'Создай детальный план проекта на основе структуры файлов.\n\n';
    }

    prompt +=
      `## Структура проекта\n\n${context.systemPrompt}\n\n` +
      '## Требования к Roadmap\n\n' +
      '1. Разбей проект на этапы (фазы)\n' +
      '2. Для каждого этапа укажи:\n' +
      '   - Название этапа\n' +
      '   - Описание задач\n' +
      '   - Ожидаемый результат\n' +
      '   - Примерные сроки\n' +
      '3. Используй Markdown-форматирование\n' +
      '4. Будь конкретным и практичным\n\n' +
      'Отвечай на русском языке.';

    return prompt;
  }

  private buildProjectSummary(analysis: ProjectAnalysis): string {
    const summary: string[] = [];
    summary.push('## Анализ состояния проекта:');
    summary.push('');

    if (analysis.totalFiles === 0) {
      summary.push('**⚠️ Проект пустой** — нужно создать начальную структуру.');
    } else {
      summary.push(`**✅ В проекте ${analysis.totalFiles} файлов**`);
    }

    summary.push('');
    summary.push('**Технологический стек:**');
    summary.push(`- Основная технология: ${analysis.technology}`);

    summary.push('');
    summary.push('**Ключевые файлы:**');
    summary.push(`- package.json: ${analysis.hasPackageJson ? '✅ есть' : '❌ нет'}`);
    summary.push(`- tsconfig.json: ${analysis.hasTsConfig ? '✅ есть' : '❌ нет'}`);
    summary.push(`- .gitignore: ${analysis.hasGitignore ? '✅ есть' : '❌ нет'}`);
    summary.push(`- README.md: ${analysis.hasReadme ? '✅ есть' : '❌ нет'}`);

    return summary.join('\n');
  }

  private countProjectFiles(tree: any): number {
    let count = 0;

    const traverse = (node: any): void => {
      if (node.type === 'file') {
        count++;
      }
      if (node.children && Array.isArray(node.children)) {
        node.children.forEach(traverse);
      }
    };

    if (tree && tree.children) {
      tree.children.forEach(traverse);
    }

    return count;
  }

  private async handleChecklist(args: string[]): Promise<CommandResult> {
    if (args.length === 0 || args[0] !== 'generate') {
      return {
        success: false,
        message:
          'Использование: /checklist generate\n\nСгенерирует чек-лист файлов проекта на основе roadmap.md.',
      };
    }

    const project = this.projectManager.getCurrentProject();
    if (!project) {
      return {
        success: false,
        message: 'Проект не открыт.',
      };
    }

    try {
      // 1. Проверяем наличие roadmap.md
      const roadmapPath = path.join(project.devilPath, 'roadmap.md');
      const roadmapExists = await this.fileSystemService.fileExists(roadmapPath);

      let roadmapContent = '';
      if (roadmapExists) {
        roadmapContent = await this.fileSystemService.readFile(roadmapPath);
        logger.info('Roadmap найден и будет использован для генерации чек-листа', 'CommandHandler');
      } else {
        logger.warn(
          'Roadmap не найден. Чек-лист будет сгенерирован на основе структуры проекта',
          'CommandHandler'
        );
      }

      // 2. Парсим roadmap (если есть)
      let roadmapPrompt = '';
      if (roadmapContent) {
        const parser = new RoadmapParser();
        const roadmap = parser.parse(roadmapContent);
        roadmapPrompt = parser.formatForPrompt(roadmap);
      }

      // 3. Строим контекст
      const context = await this.contextBuilder.buildContext('Создай чек-лист файлов', {
        includeProjectStructure: true,
        includeRoadmap: true,
      });

      // 4. Формируем промпт
      let prompt =
        'Ты — опытный разработчик. Создай чек-лист файлов проекта в формате Markdown.\n\n';

      if (roadmapPrompt) {
        prompt += '## Roadmap проекта\n\n' + roadmapPrompt + '\n\n';
        prompt += 'На основе этого roadmap создай чек-лист, сгруппированный по этапам.\n\n';
      }

      prompt += '## Структура проекта\n\n' + context.systemPrompt + '\n\n';
      prompt += '## Требования к чек-листу\n\n';
      prompt += '1. Сгруппируй файлы по этапам (если есть roadmap) или по функциональности\n';
      prompt += '2. Для каждого файла укажи:\n';
      prompt += '   - Путь к файлу (относительно корня проекта)\n';
      prompt += '   - Краткое описание назначения (1 предложение)\n';
      prompt += '3. Используй формат с чекбоксами:\n';
      prompt += '   `- [ ] \`путь/к/файлу\` — описание`\n\n';
      prompt += '4. Если файл уже существует в проекте, пометь его как `[x]` вместо `[ ]`\n';
      prompt += '5. Будь конкретным и практичным\n\n';
      prompt += 'Отвечай на русском языке.';

      // 5. Генерируем чек-лист через LLM
      const response = await this.llmProvider.generate(prompt, {
        systemPrompt: context.systemPrompt,
      });

      // 6. Валидируем пути и помечаем существующие файлы
      let checklistContent = response.content;
      const validationReport = await this.validateChecklistPaths(project.path, checklistContent);

      if (validationReport.updated) {
        checklistContent = validationReport.content;
        logger.info(
          `Валидация путей: обновлено ${validationReport.markedExisting} существующих файлов`,
          'CommandHandler'
        );
      }

      // 7. Сохраняем чек-лист
      const checklistPath = path.join(project.devilPath, 'checklist.md');
      await this.fileSystemService.writeFile(checklistPath, checklistContent);

      // 8. Формируем сообщение
      let message = '✅ Чек-лист сгенерирован и сохранён в `.devil/checklist.md`\n\n';

      if (roadmapExists) {
        message += `📋 Основан на roadmap.md (${validationReport.totalFiles} файлов)\n\n`;
      }

      if (validationReport.markedExisting > 0) {
        message += `✓ Отмечено ${validationReport.markedExisting} существующих файлов\n\n`;
      }

      message += checklistContent;

      return {
        success: true,
        message,
        data: { path: checklistPath, content: checklistContent },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Ошибка генерации чек-листа: ' + errorMessage,
      };
    }
  }

  private async handleChecklistSync(): Promise<CommandResult> {
    const project = this.projectManager.getCurrentProject();
    if (!project) {
      return {
        success: false,
        message: 'Проект не открыт.',
      };
    }

    try {
      const checklistPath = path.join(project.devilPath, 'checklist.md');
      const exists = await this.fileSystemService.fileExists(checklistPath);

      if (!exists) {
        return {
          success: false,
          message:
            '📄 Чек-лист не найден (`.devil/checklist.md`).\n\n' +
            'Сначала выполните команду `/checklist generate` для создания чек-листа.',
        };
      }

      const checklistContent = await this.fileSystemService.readFile(checklistPath);

      const sync = new ChecklistSync(this.fileSystemService);
      const result = await sync.sync(project.path, checklistContent);

      // Сохраняем обновлённый чек-лист
      await this.fileSystemService.writeFile(checklistPath, result.content);

      const message =
        '✅ Чек-лист синхронизирован с реальной структурой проекта\n\n' +
        `📊 **Отчёт:**\n` +
        `- Всего элементов: ${result.totalItems}\n` +
        `- ${result.report}\n\n` +
        result.content;

      return {
        success: true,
        message,
        data: { path: checklistPath, content: result.content, report: result.report },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Ошибка синхронизации чек-листа: ' + errorMessage,
      };
    }
  }

  /**
   * Валидирует пути в чек-листе и помечает существующие файлы как [x].
   */
  private async validateChecklistPaths(
    projectPath: string,
    checklistContent: string
  ): Promise<{ content: string; markedExisting: number; totalFiles: number; updated: boolean }> {
    const lines = checklistContent.split('\n');
    let markedExisting = 0;
    let totalFiles = 0;
    let updated = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Ищем строки с чекбоксами: - [ ] `path` или - [x] `path`
      const match = line.match(/^(\s*)- \[([ x])\] `([^`]+)`/);
      if (match) {
        totalFiles++;
        const [, indent, checkbox, filePath] = match;

        // Проверяем, существует ли файл
        const fullPath = path.join(projectPath, filePath);
        const exists = await this.fileSystemService.fileExists(fullPath);

        if (exists && checkbox === ' ') {
          // Помечаем как существующий
          lines[i] = `${indent}- [x] \`${filePath}\``;
          markedExisting++;
          updated = true;
        }
      }
    }

    return {
      content: lines.join('\n'),
      markedExisting,
      totalFiles,
      updated,
    };
  }

  private async handleExplain(args: string[], selectedCode: string | null): Promise<CommandResult> {
    if (args.length === 0) {
      return {
        success: false,
        message: 'Использование: /explain <путь_к_файлу>\n\nПример: /explain src/extension.ts',
      };
    }

    const filePath = args[0];
    const project = this.projectManager.getCurrentProject();

    if (!project) {
      return {
        success: false,
        message: 'Проект не открыт.',
      };
    }

    const fullPath = project.path + '/' + filePath;

    try {
      const exists = await this.fileSystemService.fileExists(fullPath);
      if (!exists) {
        return {
          success: false,
          message: 'Файл не найден: ' + filePath,
        };
      }

      const content = await this.fileSystemService.readFile(fullPath);
      const context = await this.contextBuilder.buildContext('Объясни код', {
        includeProjectStructure: true,
      });

      const codeToExplain = selectedCode || content;
      const codeLabel = selectedCode ? 'выделенный фрагмент из файла' : 'весь файл';

      const prompt =
        'Ты — опытный разработчик. Объясни следующий код на русском языке.\n\n' +
        'Файл: ' +
        filePath +
        ' (' +
        codeLabel +
        ')\n\n' +
        '```' +
        this.getLanguage(filePath) +
        '\n' +
        codeToExplain +
        '\n' +
        '```\n\n' +
        'Объясни:\n' +
        '1. Что делает этот код\n' +
        '2. Основные функции/классы и их назначение\n' +
        '3. Ключевые моменты и паттерны\n' +
        '4. Возможные улучшения\n\n' +
        'Будь краток и по делу.';

      const response = await this.llmProvider.generate(prompt, {
        systemPrompt: context.systemPrompt,
      });

      return {
        success: true,
        message: '## Объяснение кода: ' + filePath + '\n\n' + response.content,
        data: { path: filePath, explanation: response.content },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Ошибка объяснения кода: ' + errorMessage,
      };
    }
  }

  private async handleRefactor(
    args: string[],
    selectedCode: string | null
  ): Promise<CommandResult> {
    if (args.length === 0) {
      return {
        success: false,
        message:
          'Использование: /refactor <путь_к_файлу>\n\nПример: /refactor src/services/UserService.ts\n\nАгент проанализирует код и предложит улучшения (SOLID, паттерны, качество).',
      };
    }

    const filePath = args[0];
    const project = this.projectManager.getCurrentProject();

    if (!project) {
      return {
        success: false,
        message: 'Проект не открыт.',
      };
    }

    const fullPath = project.path + '/' + filePath;

    try {
      const exists = await this.fileSystemService.fileExists(fullPath);
      if (!exists) {
        return {
          success: false,
          message: 'Файл не найден: ' + filePath,
        };
      }

      const content = await this.fileSystemService.readFile(fullPath);
      const context = await this.contextBuilder.buildContext('Рефакторинг кода', {
        includeProjectStructure: true,
        includeMemoryGraph: true,
        includeUserProfile: true,
      });

      const codeToRefactor = selectedCode || content;
      const codeLabel = selectedCode ? 'выделенный фрагмент из файла' : 'весь файл';
      const language = this.getLanguage(filePath);

      const prompt =
        'Ты — опытный разработчик и эксперт по рефакторингу. Проанализируй следующий код и предложи улучшения.\n\n' +
        'Файл: ' +
        filePath +
        ' (' +
        codeLabel +
        ')\n' +
        'Язык: ' +
        language +
        '\n\n' +
        '```' +
        language +
        '\n' +
        codeToRefactor +
        '\n```\n\n' +
        'Выполни следующие шаги:\n\n' +
        '## 1. Анализ проблем\n' +
        'Найди проблемы в коде:\n' +
        '- Нарушения SOLID принципов\n' +
        '- Дублирование кода (DRY)\n' +
        '- Сложные/запутанные участки\n' +
        '- Потенциальные баги или edge cases\n' +
        '- Отсутствие обработки ошибок\n' +
        '- Проблемы с типизацией (если TypeScript)\n' +
        '- Неоптимальные алгоритмы\n\n' +
        '## 2. Улучшенная версия\n' +
        'Предложи полностью улучшенную версию кода в блоке ```' +
        language +
        '.\n' +
        'Сохрани функциональность, но улучши:\n' +
        '- Читаемость и структуру\n' +
        '- Применение паттернов проектирования (если уместно)\n' +
        '- Обработку ошибок\n' +
        '- Типизацию\n' +
        '- Производительность (если есть проблемы)\n\n' +
        '## 3. Объяснение изменений\n' +
        'Для каждого изменения объясни:\n' +
        '- Что было изменено\n' +
        '- Почему это улучшение\n' +
        '- Какой принцип применён (SOLID, DRY, KISS и т.д.)\n\n' +
        '## 4. Diff (опционально)\n' +
        'Если изменения точечные, покажи unified diff.\n\n' +
        'Будь конкретным и практичным. Не меняй код ради изменений.' +
        '# ВАЖНО:\n' +
        '- Не выдумывай проблемы, которых нет в коде\n' +
        '- Проверяй имена функций и переменных перед критикой\n' +
        '- Если не уверен в проблеме — укажи это явно\n' +
        '- Сосредоточься на реальных улучшениях, а не на over-engineering\n\n';

      const response = await this.llmProvider.generate(prompt, {
        systemPrompt: context.systemPrompt,
      });

      return {
        success: true,
        message: '## 🔧 Рефакторинг: ' + filePath + '\n\n' + response.content,
        data: { path: filePath, refactored: response.content },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Ошибка рефакторинга: ' + errorMessage,
      };
    }
  }

  private async handleTestGenerate(
    args: string[],
    selectedCode: string | null
  ): Promise<CommandResult> {
    // Нормализация: если первый аргумент "generate", убираем его
    if (args.length > 0 && args[0].toLowerCase() === 'generate') {
      args = args.slice(1);
    }

    if (args.length === 0) {
      return {
        success: false,
        message:
          'Использование: /test generate <путь_к_файлу> (или /test <путь>)\n\nПример: /test generate src/services/ConfigManager.ts\n\nАгент сгенерирует юнит-тесты для файла или функции.',
      };
    }

    const filePath = args[0];
    const project = this.projectManager.getCurrentProject();

    if (!project) {
      return {
        success: false,
        message: 'Проект не открыт.',
      };
    }

    const fullPath = project.path + '/' + filePath;

    try {
      const exists = await this.fileSystemService.fileExists(fullPath);
      if (!exists) {
        return {
          success: false,
          message: 'Файл не найден: ' + filePath,
        };
      }

      const content = await this.fileSystemService.readFile(fullPath);

      // Определяем фреймворк тестирования из package.json
      const testFramework = await this.detectTestFramework(project.path);

      const context = await this.contextBuilder.buildContext('Генерация тестов', {
        includeProjectStructure: true,
        includeMemoryGraph: true,
      });

      const codeToTest = selectedCode || content;
      const codeLabel = selectedCode ? 'выделенный фрагмент из файла' : 'весь файл';
      const language = this.getLanguage(filePath);

      const prompt =
        'Ты — опытный разработчик, специализирующийся на тестировании. Сгенерируй юнит-тесты для следующего кода.\n\n' +
        'Файл: ' +
        filePath +
        ' (' +
        codeLabel +
        ')\n' +
        'Язык: ' +
        language +
        '\n' +
        'Фреймворк тестирования: ' +
        testFramework +
        '\n\n' +
        '```' +
        language +
        '\n' +
        codeToTest +
        '\n```\n\n' +
        'Выполни следующие шаги:\n\n' +
        '## 1. Анализ кода\n' +
        'Определи:\n' +
        '- Какие функции/классы/методы нужно протестировать\n' +
        '- Какие зависимости нужно замокать\n' +
        '- Какие edge cases нужно учесть\n' +
        '- Какие сценарии покрытия (happy path, error cases, boundary values)\n\n' +
        '## 2. Генерация тестов\n' +
        'Создай полный файл тестов в блоке ```' +
        this.getTestFileExtension(testFramework) +
        ':\n' +
        '- Используй синтаксис ' +
        testFramework +
        '\n' +
        '- Следуй best practices ' +
        testFramework +
        '\n' +
        '- Покрой основные сценарии:\n' +
        '  * Happy path (успешные сценарии)\n' +
        '  * Error cases (ошибки, исключения)\n' +
        '  * Boundary values (граничные значения)\n' +
        '  * Edge cases (особые случаи)\n' +
        '- Используй describe/it или test/expect (в зависимости от фреймворка)\n' +
        '- Добавь понятные названия тестов (should ... when ...)\n' +
        '- Мокай внешние зависимости (HTTP, БД, файловая система)\n\n' +
        '## 3. Пояснения\n' +
        'Объясни:\n' +
        '- Почему выбраны именно эти тесты\n' +
        '- Какие зависимости замоканы и почему\n' +
        '- Как запустить тесты\n' +
        '- Какую команду использовать для запуска\n\n' +
        '## 4. Рекомендации\n' +
        'Предложи:\n' +
        '- Дополнительные тесты, которые можно добавить\n' +
        '- Улучшения в основном коде для лучшей тестируемости\n' +
        '- Покрытие кода (примерное, в %)\n\n' +
        'Будь практичным и следуй best practices тестирования.';

      const response = await this.llmProvider.generate(prompt, {
        systemPrompt: context.systemPrompt,
      });

      return {
        success: true,
        message: '## 🧪 Тесты для: ' + filePath + '\n\n' + response.content,
        data: { path: filePath, tests: response.content, framework: testFramework },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Ошибка генерации тестов: ' + errorMessage,
      };
    }
  }

  private async handleDevGenerate(): Promise<CommandResult> {
    if (!this.devPlanManager) {
      return {
        success: false,
        message: '❌ DevPlanManager не инициализирован.',
      };
    }

    const project = this.projectManager.getCurrentProject();
    if (!project) {
      return {
        success: false,
        message: 'Проект не открыт.',
      };
    }

    try {
      // Инициализируем DevPlanManager для текущего проекта
      await this.devPlanManager.initialize(project.path);

      // Проверяем, есть ли уже план
      const existingPlan = this.devPlanManager.getCurrentPlan();
      if (existingPlan) {
        return {
          success: false,
          message:
            '📋 План разработки уже существует.\n\n' +
            `**Статус:** ${existingPlan.completedSteps}/${existingPlan.totalSteps} шагов выполнено\n\n` +
            'Используйте команды:\n' +
            '- `/dev next` — выполнить следующий шаг\n' +
            '- `/dev status` — показать прогресс\n' +
            '- `/dev reset` — сбросить план и создать новый\n\n' +
            '💡 **Совет:** Перед созданием нового плана выполните `/checklist sync` для актуализации чек-листа.',
        };
      }

      // Генерируем новый план
      const result = await this.devPlanManager.generatePlan();

      if (!result.success || !result.plan) {
        return {
          success: false,
          message: '❌ Ошибка генерации плана: ' + (result.error || 'неизвестная ошибка'),
        };
      }

      // Формируем красивое сообщение с планом
      const planMessage = this.formatPlanForChat(result.plan);

      return {
        success: true,
        message: planMessage,
        data: { plan: result.plan },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Ошибка генерации плана: ' + errorMessage,
      };
    }
  }

  private async handleDevNext(): Promise<CommandResult> {
    if (!this.devPlanManager) {
      return { success: false, message: '❌ DevPlanManager не инициализирован.' };
    }
    if (!this.devPlanExecutor) {
      return { success: false, message: '❌ DevPlanExecutor не инициализирован.' };
    }

    const project = this.projectManager.getCurrentProject();
    if (!project) {
      return { success: false, message: 'Проект не открыт.' };
    }

    try {
      await this.devPlanManager.initialize(project.path);
      const result = await this.devPlanExecutor.executeNextStep(project.path);

      if (!result.success) {
        return { success: false, message: '❌ ' + result.error };
      }

      // Формируем сообщение с командами
      let message = result.message + '\n\n';

      if (result.commands && result.commands.length > 0) {
        message += '**Команды для проверки:**\n```bash\n';
        message += result.commands.join('\n');
        message += '\n```\n\n';
      }

      if (result.backupPath) {
        message += `📦 **Бэкап создан:** \`${result.backupPath}\`\n\n`;
      }

      // Показываем прогресс
      const plan = this.devPlanManager.getCurrentPlan();
      if (plan) {
        message += `📊 **Прогресс:** ${plan.completedSteps}/${plan.totalSteps} шагов\n`;
      }

      return { success: true, message, data: result };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, message: 'Ошибка выполнения шага: ' + errorMessage };
    }
  }

  private async handleDevStatus(): Promise<CommandResult> {
    if (!this.devPlanManager) {
      return { success: false, message: '❌ DevPlanManager не инициализирован.' };
    }
    if (!this.devPlanManager) {
      return { success: false, message: '❌ DevPlanManager не инициализирован.' };
    }

    const project = this.projectManager.getCurrentProject();
    if (!project) {
      return { success: false, message: 'Проект не открыт.' };
    }

    try {
      await this.devPlanManager.initialize(project.path);
      const plan = this.devPlanManager.getCurrentPlan();

      if (!plan) {
        return {
          success: false,
          message: '📋 План разработки не найден. Выполните `/dev generate`.',
        };
      }

      const lines: string[] = [];
      lines.push('## 📊 Статус плана разработки\n');
      lines.push(`**Статус:** ${plan.status}\n`);
      lines.push(`**Прогресс:** ${plan.completedSteps}/${plan.totalSteps} шагов\n`);
      lines.push('---\n');

      // Группируем по статусу
      const completed = plan.steps.filter((s) => s.status === 'completed');
      const inProgress = plan.steps.filter((s) => s.status === 'in_progress');
      const pending = plan.steps.filter((s) => s.status === 'pending');
      const skipped = plan.steps.filter((s) => s.status === 'skipped');

      if (completed.length > 0) {
        lines.push('### ✅ Выполнено\n');
        completed.forEach((s) => lines.push(`- [x] **Шаг ${s.id}:** ${s.path} — ${s.description}`));
        lines.push('');
      }

      if (inProgress.length > 0) {
        lines.push('### 🔄 В процессе\n');
        inProgress.forEach((s) =>
          lines.push(`- [ ] **Шаг ${s.id}:** ${s.path} — ${s.description}`)
        );
        lines.push('');
      }

      if (pending.length > 0) {
        lines.push('### ⏳ Ожидает\n');
        pending.forEach((s) => lines.push(`- [ ] **Шаг ${s.id}:** ${s.path} — ${s.description}`));
        lines.push('');
      }

      if (skipped.length > 0) {
        lines.push('### ⏭️ Пропущено\n');
        skipped.forEach((s) => lines.push(`- [ ] **Шаг ${s.id}:** ${s.path} — ${s.description}`));
        lines.push('');
      }

      return { success: true, message: lines.join('\n'), data: plan };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, message: 'Ошибка получения статуса: ' + errorMessage };
    }
  }

  private async handleDevSkip(args: string[]): Promise<CommandResult> {
    if (!this.devPlanManager) {
      return { success: false, message: '❌ DevPlanManager не инициализирован.' };
    }
    if (!this.devPlanManager) {
      return { success: false, message: '❌ DevPlanManager не инициализирован.' };
    }

    const project = this.projectManager.getCurrentProject();
    if (!project) {
      return { success: false, message: 'Проект не открыт.' };
    }

    try {
      await this.devPlanManager.initialize(project.path);
      const plan = this.devPlanManager.getCurrentPlan();

      if (!plan) {
        return { success: false, message: '📋 План разработки не найден.' };
      }

      // Определяем, какой шаг пропустить
      let stepId: number;
      if (args.length > 0 && args[0] === 'skip' && args[1]) {
        stepId = parseInt(args[1], 10);
      } else {
        const nextStep = this.devPlanManager.getNextStep();
        if (!nextStep) {
          return { success: false, message: 'Нет шагов для пропуска.' };
        }
        stepId = nextStep.id;
      }

      await this.devPlanManager.updateStepStatus(stepId, 'skipped');

      return {
        success: true,
        message: `⏭️ Шаг ${stepId} пропущен.\n\n📊 **Прогресс:** ${plan.completedSteps}/${plan.totalSteps} шагов`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, message: 'Ошибка пропуска шага: ' + errorMessage };
    }
  }

  private async handleDevReset(): Promise<CommandResult> {
    if (!this.devPlanManager) {
      return { success: false, message: '❌ DevPlanManager не инициализирован.' };
    }
    if (!this.devPlanManager) {
      return { success: false, message: '❌ DevPlanManager не инициализирован.' };
    }

    const project = this.projectManager.getCurrentProject();
    if (!project) {
      return { success: false, message: 'Проект не открыт.' };
    }

    try {
      await this.devPlanManager.initialize(project.path);
      await this.devPlanManager.resetPlan();

      return {
        success: true,
        message:
          '🔄 План разработки сброшен.\n\n' +
          '💡 **Рекомендуемый порядок действий:**\n' +
          '1. Выполните `/checklist sync` — обновить чек-лист с реальной структурой проекта\n' +
          '2. Выполните `/dev generate` — создать новый план на основе актуального чек-листа\n',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, message: 'Ошибка сброса плана: ' + errorMessage };
    }
  }

  /**
   * Форматирует план для отображения в чате.
   */
  private formatPlanForChat(plan: import('../interfaces/IDevPlan').DevPlan): string {
    const lines: string[] = [];

    lines.push('✅ **План разработки сгенерирован**\n');
    lines.push(`📊 **Статус:** ${plan.completedSteps}/${plan.totalSteps} шагов выполнено\n`);
    lines.push('---\n');

    // Группируем шаги по типу
    const directories = plan.steps.filter((s) => s.type === 'create_directory');
    const files = plan.steps.filter((s) => s.type === 'create_file' || s.type === 'modify_file');

    if (directories.length > 0) {
      lines.push('## 📁 Создание структуры директорий\n');
      directories.forEach((step) => {
        const checkbox = step.status === 'completed' ? '[x]' : '[ ]';
        lines.push(`- ${checkbox} **Шаг ${step.id}:** \`${step.path}\` — ${step.description}`);
      });
      lines.push('');
    }

    if (files.length > 0) {
      lines.push('## 📄 Создание файлов\n');
      files.forEach((step) => {
        const checkbox = step.status === 'completed' ? '[x]' : '[ ]';
        const deps =
          step.dependencies && step.dependencies.length > 0
            ? ` (зависит от: ${step.dependencies.join(', ')})`
            : '';
        lines.push(
          `- ${checkbox} **Шаг ${step.id}:** \`${step.path}\` — ${step.description}${deps}`
        );
      });
      lines.push('');
    }

    lines.push('---\n');
    lines.push('💡 **Команды для управления планом:**\n');
    lines.push('- `/dev next` — выполнить следующий шаг');
    lines.push('- `/dev status` — показать прогресс');
    lines.push('- `/dev skip` — пропустить шаг');
    lines.push('- `/dev reset` — сбросить план');

    return lines.join('\n');
  }

  /**
   * Определяет фреймворк тестирования из package.json.
   */
  private async detectTestFramework(projectPath: string): Promise<string> {
    try {
      const packageJsonPath = projectPath + '/package.json';
      const exists = await this.fileSystemService.fileExists(packageJsonPath);
      if (!exists) {
        return 'Jest (по умолчанию)';
      }

      const content = await this.fileSystemService.readFile(packageJsonPath);
      const packageJson = JSON.parse(content);

      const allDeps = {
        ...(packageJson.dependencies || {}),
        ...(packageJson.devDependencies || {}),
      };

      if (allDeps['vitest']) return 'Vitest';
      if (allDeps['mocha']) return 'Mocha';
      if (allDeps['jest']) return 'Jest';
      if (allDeps['@testing-library/react']) return 'Jest + React Testing Library';
      if (allDeps['ava']) return 'AVA';
      if (allDeps['tape']) return 'Tape';

      // Проверяем scripts
      const scripts = packageJson.scripts || {};
      const scriptsText = JSON.stringify(scripts).toLowerCase();
      if (scriptsText.includes('vitest')) return 'Vitest';
      if (scriptsText.includes('mocha')) return 'Mocha';
      if (scriptsText.includes('jest')) return 'Jest';

      return 'Jest (по умолчанию)';
    } catch (error) {
      return 'Jest (по умолчанию)';
    }
  }

  /**
   * Возвращает расширение файла тестов для фреймворка.
   */
  private getTestFileExtension(framework: string): string {
    if (framework.includes('Jest') || framework.includes('Mocha') || framework.includes('Vitest')) {
      return 'typescript';
    }
    return 'javascript';
  }

  private async handleSearch(args: string[]): Promise<CommandResult> {
    if (args.length === 0) {
      return {
        success: false,
        message:
          'Использование: /search <запрос>\n\nПример: /search useEffect\n\nИщет по содержимому файлов проекта с использованием полнотекстового индекса.',
      };
    }

    const project = this.projectManager.getCurrentProject();
    if (!project) {
      return {
        success: false,
        message: 'Проект не открыт. Используйте команду "Devil: Open Project".',
      };
    }

    if (!this.searchIndex.isInitialized()) {
      return {
        success: false,
        message: 'Индекс поиска ещё не построен. Пожалуйста, подождите несколько секунд.',
      };
    }

    const query = args.join(' ');
    const startTime = Date.now();

    try {
      const results = await this.searchIndex.search(query, { limit: 200 });
      const duration = Date.now() - startTime;

      if (results.length === 0) {
        return {
          success: false,
          message:
            'По запросу "' +
            query +
            '" ничего не найдено.\n\n' +
            'Убедитесь, что индекс построен (команда выполняется автоматически при открытии проекта).',
        };
      }

      const byFile: Record<string, typeof results> = {};
      for (const result of results) {
        if (!byFile[result.filePath]) {
          byFile[result.filePath] = [];
        }
        byFile[result.filePath].push(result);
      }

      const lines: string[] = [];
      lines.push('## Результаты поиска: "' + query + '"');
      lines.push('');
      lines.push(
        'Найдено **' +
          results.length +
          '** совпадений в **' +
          Object.keys(byFile).length +
          '** файлах за ' +
          duration +
          'мс'
      );
      lines.push('');

      for (const [filePath, fileResults] of Object.entries(byFile)) {
        // Создаём кликабельную ссылку на файл
        const fileUrl = project ? 'vscode://file/' + project.path + '/' + filePath : filePath;
        lines.push('### 📄 [' + filePath + '](' + fileUrl + ')');
        lines.push('');

        for (const result of fileResults.slice(0, 5)) {
          // Добавляем кликабельную ссылку на строку
          const lineUrl = fileUrl + ':' + result.line;
          lines.push('**[Строка ' + result.line + '](' + lineUrl + ')**');
          lines.push('```');
          lines.push(result.content.trim());
          lines.push('```');
          lines.push('');
        }

        if (fileResults.length > 5) {
          lines.push('_... и ещё ' + (fileResults.length - 5) + ' совпадений в этом файле_');
          lines.push('');
        }
      }

      // BCK-31: Сохраняем результаты поиска в change_log для улучшения контекста LLM
      try {
        await this.memoryStore.addChangeLog({
          project_path: project.path,
          action: 'search_hit',
          target: query,
          description:
            'Поиск: ' + results.length + ' совпадений в ' + Object.keys(byFile).length + ' файлах',
          metadata: {
            query,
            totalResults: results.length,
            fileCount: Object.keys(byFile).length,
            files: Object.keys(byFile),
            duration,
          },
        });
        logger.info('Результаты поиска сохранены в change_log', 'CommandHandler');
      } catch (logError) {
        logger.warn('Не удалось сохранить результаты поиска в change_log', 'CommandHandler');
      }

      return {
        success: true,
        message: lines.join('\n'),
        data: { query, results, duration, fileCount: Object.keys(byFile).length },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Ошибка поиска: ' + errorMessage,
      };
    }
  }

  private async handleWhereis(args: string[]): Promise<CommandResult> {
    if (args.length === 0) {
      return {
        success: false,
        message:
          'Использование: /whereis <имя_символа>\n\nПример: /whereis activate\n\nИщет функции, классы, интерфейсы и переменные по имени.',
      };
    }

    const symbolName = args.join(' ');

    try {
      const nodes = await this.memoryStore.getNodeByName(symbolName);

      if (nodes.length === 0) {
        return {
          success: false,
          message:
            'Символ "' +
            symbolName +
            '" не найден в графе проекта.\n\n' +
            'Возможно, проект ещё не просканирован. Используйте команду "Devil: Open Project" для инициализации.',
        };
      }

      const byType: Record<string, Array<{ name: string; path: string; signature?: string }>> = {};

      for (const node of nodes) {
        if (!byType[node.type]) {
          byType[node.type] = [];
        }
        byType[node.type].push({
          name: node.name,
          path: node.path || '',
          signature: node.metadata?.signature as string | undefined,
        });
      }

      const lines: string[] = [];
      lines.push('## Найдено символов: ' + nodes.length);
      lines.push('');

      const typeLabels: Record<string, string> = {
        function: 'Функции',
        class: 'Классы',
        interface: 'Интерфейсы',
        type: 'Типы',
        variable: 'Переменные',
        file: 'Файлы',
      };

      for (const [type, items] of Object.entries(byType)) {
        const label = typeLabels[type] || type;
        lines.push('### ' + label + ' (' + items.length + ')');
        lines.push('');

        for (const item of items) {
          lines.push('- **' + item.name + '** в `' + item.path + '`');
          if (item.signature) {
            lines.push('  ```typescript');
            lines.push('  ' + item.signature);
            lines.push('  ```');
          }
        }
        lines.push('');
      }

      return {
        success: true,
        message: lines.join('\n'),
        data: { symbol: symbolName, count: nodes.length, nodes },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Ошибка поиска символа: ' + errorMessage,
      };
    }
  }

  private async handleDiff(args: string[]): Promise<CommandResult> {
    try {
      let diffContent: string;

      if (args.length === 0) {
        diffContent = await this.gitService.getDiff('HEAD~1', 'HEAD');
      } else if (args.length === 1) {
        const commit = args[0];
        diffContent = await this.gitService.getDiff(commit + '~1', commit);
      } else if (args.length === 2) {
        diffContent = await this.gitService.getDiff(args[0], args[1]);
      } else {
        return {
          success: false,
          message:
            'Использование:\n' +
            '- `/diff` — показать последние изменения\n' +
            '- `/diff <commit>` — показать изменения в коммите\n' +
            '- `/diff <commitA> <commitB>` — показать diff между коммитами',
        };
      }

      if (!diffContent || diffContent.trim() === '') {
        return {
          success: false,
          message: 'Diff пуст или коммиты не найдены.',
        };
      }

      const lines = diffContent.split('\n');
      const formattedLines: string[] = [];

      for (const line of lines) {
        if (line.startsWith('+++') || line.startsWith('---')) {
          formattedLines.push('**' + line + '**');
        } else if (line.startsWith('+')) {
          formattedLines.push('+ ' + line.substring(1));
        } else if (line.startsWith('-')) {
          formattedLines.push('- ' + line.substring(1));
        } else {
          formattedLines.push(line);
        }
      }

      const markdown = '## Diff\n\n```diff\n' + formattedLines.join('\n') + '\n```';

      return {
        success: true,
        message: markdown,
        data: { diff: diffContent },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Ошибка получения diff: ' + errorMessage,
      };
    }
  }

  private async handleGit(args: string[]): Promise<CommandResult> {
    if (args.length === 0 || args[0] !== 'log') {
      return {
        success: false,
        message:
          'Использование: /git log [путь_к_файлу]\n\nПример: /git log package.json\n\nПоказывает историю коммитов для файла или проекта.',
      };
    }

    const filePath = args.length > 1 ? args[1] : undefined;

    try {
      const commits = await this.gitService.getLog(filePath, 20);

      if (commits.length === 0) {
        return {
          success: false,
          message: filePath
            ? 'История коммитов для файла "' + filePath + '" не найдена.'
            : 'История коммитов пуста.',
        };
      }

      const lines: string[] = [];
      lines.push('## История коммитов' + (filePath ? ' для ' + filePath : ''));
      lines.push('');

      for (const commit of commits) {
        lines.push('### ' + commit.hash.substring(0, 7) + ' — ' + commit.message);
        lines.push('**Автор:** ' + commit.author + ' | **Дата:** ' + commit.date);
        lines.push('');
      }

      return {
        success: true,
        message: lines.join('\n'),
        data: { commits, filePath },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Ошибка получения истории коммитов: ' + errorMessage,
      };
    }
  }

  private async handleMemory(args: string[]): Promise<CommandResult> {
    if (args.length === 0 || args[0] !== 'show') {
      return {
        success: false,
        message:
          'Использование: /memory show\n\nПоказать графовую память проекта в табличном виде.',
      };
    }

    try {
      const nodes = await this.memoryStore.findNodes({ limit: 200 });

      if (nodes.length === 0) {
        return {
          success: false,
          message: 'Графовая память пуста. Проект ещё не просканирован.',
        };
      }

      const byType: Record<string, typeof nodes> = {};
      for (const node of nodes) {
        if (!byType[node.type]) {
          byType[node.type] = [];
        }
        byType[node.type].push(node);
      }

      const lines: string[] = [];
      lines.push('## Графовая память проекта');
      lines.push('');
      lines.push('Всего узлов: **' + nodes.length + '**');
      lines.push('');

      const typeLabels: Record<string, string> = {
        file: 'Файлы',
        class: 'Классы',
        function: 'Функции',
        interface: 'Интерфейсы',
        type: 'Типы',
        variable: 'Переменные',
      };

      for (const [type, typeNodes] of Object.entries(byType)) {
        const label = typeLabels[type] || type;
        lines.push('### ' + label + ' (' + typeNodes.length + ')');
        lines.push('');
        lines.push('| Имя | Путь |');
        lines.push('|-----|------|');

        for (const node of typeNodes.slice(0, 20)) {
          const name = node.name || '';
          const path = node.path || '';
          lines.push('| `' + name + '` | `' + path + '` |');
        }

        if (typeNodes.length > 20) {
          lines.push('| ... | и ещё ' + (typeNodes.length - 20) + ' |');
        }

        lines.push('');
      }

      return {
        success: true,
        message: lines.join('\n'),
        data: { nodes, count: nodes.length },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Ошибка получения памяти: ' + errorMessage,
      };
    }
  }

  private async handleView(args: string[]): Promise<CommandResult> {
    if (args.length === 0) {
      return {
        success: false,
        message:
          'Использование:\n' +
          '- `/view roadmap` — показать Roadmap проекта\n' +
          '- `/view checklist` — показать чек-лист файлов\n' +
          '- `/view <путь>` — показать любой Markdown-файл из .devil/',
      };
    }

    const project = this.projectManager.getCurrentProject();
    if (!project) {
      return {
        success: false,
        message: 'Проект не открыт. Используйте команду "Devil: Open Project".',
      };
    }

    const fileName = args[0].toLowerCase();
    let filePath: string;

    if (fileName === 'roadmap') {
      filePath = 'roadmap.md';
    } else if (fileName === 'checklist') {
      filePath = 'checklist.md';
    } else {
      filePath = args.join(' ');
    }

    const fullPath = project.devilPath + '/' + filePath;

    try {
      const exists = await this.fileSystemService.fileExists(fullPath);
      if (!exists) {
        return {
          success: false,
          message:
            'Файл не найден: .devil/' +
            filePath +
            '\n\n' +
            'Используйте `/roadmap generate` или `/checklist generate` для создания файла.',
        };
      }

      const fileContent = await this.fileSystemService.readFile(fullPath);

      let header = '## Содержимое файла: .devil/' + filePath;
      if (fileName === 'roadmap') {
        header = '## 🗺️ Roadmap проекта';
      } else if (fileName === 'checklist') {
        header = '## ✅ Чек-лист файлов проекта';
      }

      return {
        success: true,
        message: header + '\n\n' + fileContent,
        data: { path: fullPath, content: fileContent },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Ошибка чтения файла: ' + errorMessage,
      };
    }
  }

  private async handleModel(args: string[]): Promise<CommandResult> {
    if (!this.multiModelManager) {
      return {
        success: false,
        message: '❌ MultiModelManager не инициализирован. Обратитесь к администратору.',
        data: {},
      };
    }

    const subCommand = args[0];

    // /model switch — показать список моделей или переключиться
    if (subCommand === 'switch') {
      const modelId = args[1];

      if (!modelId) {
        // Показать список моделей
        const models = this.multiModelManager.getAvailableModels();
        const currentId = this.multiModelManager.getCurrentModelId();

        if (models.length === 0) {
          return {
            success: false,
            message: '❌ Нет настроенных моделей. Добавьте модели в settings.json (devil.models).',
            data: { models: [] },
          };
        }

        let message = '## Доступные модели LLM\n\n';
        message += '| ID | Название | Модель | Задачи | Статус |\n';
        message += '|----|----------|--------|--------|--------|\n';

        for (const model of models) {
          const isActive = model.id === currentId;
          const status = isActive ? '✅ активна' : '';
          const tasks = model.taskTypes.join(', ');
          message += `| \`${model.id}\` | ${model.name} | \`${model.model}\` | ${tasks} | ${status} |\n`;
        }

        message += '\n\n**Использование:** `/model switch <id>` для переключения.';

        return {
          success: true,
          message,
          data: { models, currentId },
        };
      }

      // Переключиться на указанную модель
      try {
        this.multiModelManager.switchModel(modelId);
        const currentModel = this.multiModelManager.getCurrentModel();

        // Применяем конфигурацию к LLMProvider
        if (currentModel && this.llmProvider) {
          this.llmProvider.applyModelConfig(currentModel);
        }

        return {
          success: true,
          message: `✅ Модель переключена на **${currentModel?.name}** (\`${currentModel?.model}\`).`,
          data: { switchedTo: modelId, model: currentModel },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          message: `❌ Ошибка переключения модели: ${errorMessage}`,
          data: {},
        };
      }
    }

    // /model current — показать текущую активную модель
    if (subCommand === 'current') {
      const currentModel = this.multiModelManager.getCurrentModel();

      if (!currentModel) {
        return {
          success: false,
          message: '❌ Нет активной модели.',
          data: {},
        };
      }

      let message = '## Текущая активная модель\n\n';
      message += `- **ID:** \`${currentModel.id}\`\n`;
      message += `- **Название:** ${currentModel.name}\n`;
      message += `- **Модель API:** \`${currentModel.model}\`\n`;
      message += `- **Base URL:** \`${currentModel.baseUrl}\`\n`;
      message += `- **Типы задач:** ${currentModel.taskTypes.join(', ')}\n`;

      return {
        success: true,
        message,
        data: { currentModel },
      };
    }

    // Неизвестная подкоманда — показать подсказку
    return {
      success: false,
      message:
        '## Использование команды /model\n\n' +
        '- `/model switch` — показать список моделей\n' +
        '- `/model switch <id>` — переключиться на модель\n' +
        '- `/model current` — показать текущую активную модель\n',
      data: {},
    };
  }

  private async handleRebuild(_args: string[]): Promise<CommandResult> {
    const project = this.projectManager.getCurrentProject();
    if (!project) {
      return {
        success: false,
        message: 'Проект не открыт. Используйте команду "Devil: Open Project".',
      };
    }

    try {
      // Очищаем все узлы и связи в графе
      const allNodes = await this.memoryStore.findNodes({ limit: 10000 });
      let deletedNodes = 0;
      for (const node of allNodes) {
        await this.memoryStore.deleteNode(node.id);
        deletedNodes++;
      }

      // Перестраиваем индекс поиска
      await this.searchIndex.clear();
      await this.searchIndex.buildIndex();

      return {
        success: true,
        message:
          '✅ Графовая память очищена (' +
          deletedNodes +
          ' узлов удалено).\n\n' +
          'Индекс поиска перестроен.\n' +
          'Для перестроения графа закройте и снова откройте проект командой "Devil: Open Project".',
        data: { deletedNodes },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Ошибка перестроения: ' + errorMessage,
      };
    }
  }

  private handleHelp(): CommandResult {
    const helpText = [
      '## Доступные команды',
      '',
      '**Поиск:**',
      '- `/search <запрос>` — поиск по содержимому файлов',
      '- `/whereis <символ>` — найти символ в проекте',
      '',
      '**Анализ кода:**',
      '- `/refactor <путь>` — предложить рефакторинг кода (SOLID, паттерны)',
      '**Генерация:**',
      '- `/dev generate` — сгенерировать план разработки',
      '- `/dev next` — выполнить следующий шаг плана',
      '- `/dev status` — показать прогресс выполнения плана',
      '- `/dev skip [id]` — пропустить шаг плана',
      '- `/dev reset` — сбросить план разработки',
      '- `/checklist generate` — сгенерировать чек-лист на основе roadmap.md',
      '- `/checklist sync` — синхронизировать чек-лист с реальной структурой проекта',
      '- `/test generate <путь>` или `/test <путь>` — сгенерировать юнит-тесты для файла',
      '- `/refactor <путь>` — предложить рефакторинг кода (SOLID, паттерны)',
      '- `/lint [путь]` — запустить ESLint для проверки кода',
      '',
      '**Файлы:**',
      '- `/git log [файл]` — показать историю коммитов',
      '- `/diff [commit]` — показать изменения в коде',
      '- `/memory show` — показать графовую память',
      '- `/rebuild` — очистить граф и перестроить индекс',
      '- `/view roadmap` — показать Roadmap проекта',
      '- `/view checklist` — показать чек-лист',
      '- `/scan <путь>` — прочитать содержимое файла',
      '- `/explain <путь>` — объяснить код файла',
      '',
      '**Планирование:**',
      '- `/roadmap generate` — сгенерировать план проекта',
      '- `/checklist generate` — сгенерировать чек-лист файлов',
      '',
      '**Выбор модели LLM:**',
      '- `/model switch` — показать список моделей',
      '- `/model switch <id>` — переключиться на модель',
      '- `/model current` — показать текущую активную модель',
      '',
      '**Другое:**',
      '- `/help` — показать этот список',
      '',
      'Все команды начинаются с `/` и вводятся в чат.',
      '',
      '**Совет:** Выделите код в редакторе, нажмите правую кнопку мыши и выберите "Объяснить код с Devil".',
    ].join('\n');

    return {
      success: true,
      message: helpText,
    };
  }

  private async handleLint(args: string[]): Promise<CommandResult> {
    const project = this.projectManager.getCurrentProject();
    if (!project) {
      return {
        success: false,
        message: 'Проект не открыт. Используйте команду "Devil: Open Project".',
      };
    }

    try {
      const targetPath = args.length > 0 ? args[0] : 'src';
      const fullPath = path.join(project.path, targetPath);

      // Проверяем, существует ли файл/папка
      const exists = await this.fileSystemService.fileExists(fullPath);
      if (!exists) {
        return {
          success: false,
          message: 'Путь не найден: ' + targetPath,
        };
      }

      // Проверяем наличие ESLint конфигурации
      const eslintConfigPaths = [
        '.eslintrc.js',
        '.eslintrc.cjs',
        '.eslintrc.yaml',
        '.eslintrc.yml',
        '.eslintrc.json',
        '.eslintrc',
        'eslint.config.js',
        'eslint.config.mjs',
        'eslint.config.cjs',
      ];

      let eslintConfigFound = false;
      for (const configPath of eslintConfigPaths) {
        const configFullPath = path.join(project.path, configPath);
        if (await this.fileSystemService.fileExists(configFullPath)) {
          eslintConfigFound = true;
          break;
        }
      }

      // Также проверяем поле eslintConfig в package.json
      if (!eslintConfigFound) {
        const pkgPath = path.join(project.path, 'package.json');
        if (await this.fileSystemService.fileExists(pkgPath)) {
          try {
            const pkgContent = await this.fileSystemService.readFile(pkgPath);
            const pkg = JSON.parse(pkgContent);
            if (pkg.eslintConfig || pkg.eslint) {
              eslintConfigFound = true;
            }
          } catch {
            // package.json невалиден — игнорируем
          }
        }
      }

      if (!eslintConfigFound) {
        return {
          success: false,
          message:
            'ESLint конфигурация не найдена в проекте.\n\n' +
            'Установите и настройте ESLint:\n' +
            '```bash\nnpm install --save-dev eslint\nnpx eslint --init\n```',
        };
      }

      logger.info('Запуск ESLint для: ' + targetPath, 'CommandHandler');

      const exec = util.promisify(child_process.exec);
      const command = `npx eslint "${targetPath}" --format json`;

      let stdout = '';
      let stderr = '';

      try {
        const result = await exec(command, {
          cwd: project.path,
          maxBuffer: 1024 * 1024 * 10, // 10 MB
        });
        stdout = result.stdout;
        stderr = result.stderr;
      } catch (execError: unknown) {
        // ESLint возвращает exit code 1 при наличии lint-ошибок — это нормально!
        // stdout в этом случае содержит валидный JSON с результатами
        if ((execError as { stdout?: string }).stdout) {
          stdout = (execError as { stdout: string }).stdout;
          stderr = (execError as { stderr?: string }).stderr || '';
          logger.info(
            'ESLint нашёл проблемы (exit code ' +
              (execError as { code?: number }).code +
              '), парсим вывод',
            'CommandHandler'
          );
        } else {
          // Реальная ошибка: ESLint не установлен, команда не найдена и т.д.
          throw execError;
        }
      }

      if (stderr && !stdout) {
        return {
          success: false,
          message:
            'ESLint не найден или произошла ошибка.\n\n' +
            'Убедитесь, что ESLint установлен:\n' +
            '```bash\nnpm install --save-dev eslint\n```\n\n' +
            'Ошибка ESLint:\n' +
            '```\n' +
            stderr +
            '\n```',
        };
      }

      // Парсим JSON вывод ESLint
      let lintResults: Array<{
        filePath: string;
        messages: Array<{
          ruleId: string;
          severity: number;
          message: string;
          line: number;
          column: number;
          nodeType?: string;
        }>;
        errorCount: number;
        warningCount: number;
      }> = [];

      try {
        lintResults = JSON.parse(stdout.trim());
      } catch (parseError: unknown) {
        // Если не удалось распарсить JSON, значит ESLint вернул пустой вывод (нет ошибок)
        if (stdout.trim() === '' && !stderr) {
          return {
            success: true,
            message: '✅ ESLint: Нет ошибок или предупреждений для ' + targetPath,
            data: { target: targetPath, results: [] },
          };
        }

        // Иначе это ошибка
        return {
          success: false,
          message: 'Не удалось распарсить вывод ESLint:\n```\n' + stdout + '\n```',
        };
      }

      // Форматируем результаты
      let totalErrors = 0;
      let totalWarnings = 0;
      const lines: string[] = [];

      lines.push('## Отчёт ESLint: ' + targetPath);
      lines.push('');

      for (const result of lintResults) {
        totalErrors += result.errorCount;
        totalWarnings += result.warningCount;

        if (result.messages.length === 0) continue;

        const relativePath = path.relative(project.path, result.filePath);
        const fileUrl = 'vscode://file/' + result.filePath;
        lines.push('### 📄 [' + relativePath + '](' + fileUrl + ')');
        lines.push('');
        lines.push('| Строка | Столбец | Уровень | Правило | Сообщение |');
        lines.push('|--------|---------|---------|---------|-----------|');

        for (const message of result.messages) {
          const severity = message.severity === 2 ? '❌ Ошибка' : '⚠️ Предупреждение';
          const ruleId = message.ruleId || 'unknown';

          // Создаём ссылку на конкретную строку
          const lineUrl = fileUrl + ':' + message.line;

          lines.push(
            '| **[Строка ' +
              message.line +
              '](' +
              lineUrl +
              ')** | ' +
              message.column +
              ' | ' +
              severity +
              ' | `' +
              ruleId +
              '` | ' +
              this.escapeTableCell(message.message) +
              ' |'
          );
        }
        lines.push('');
      }

      // Сводка
      lines.push('### 📊 Сводка');
      lines.push('');
      lines.push('- **Всего файлов:** ' + lintResults.length);
      lines.push('- **Ошибки:** ' + totalErrors);
      lines.push('- **Предупреждения:** ' + totalWarnings);
      lines.push('');

      if (totalErrors === 0 && totalWarnings === 0) {
        lines.push('✅ **Код соответствует правилам ESLint!**');
      }

      // BCK-31: Сохраняем ошибки линтера в change_log для улучшения контекста LLM
      if (totalErrors > 0 || totalWarnings > 0) {
        try {
          await this.memoryStore.addChangeLog({
            project_path: project.path,
            action: 'lint_error',
            target: targetPath,
            description: 'ESLint: ' + totalErrors + ' ошибок, ' + totalWarnings + ' предупреждений',
            metadata: {
              totalErrors,
              totalWarnings,
              fileCount: lintResults.length,
              files: lintResults
                .filter((r) => r.messages.length > 0)
                .map((r) => ({
                  file: path.relative(project.path, r.filePath),
                  errors: r.errorCount,
                  warnings: r.warningCount,
                })),
            },
          });
          logger.info('Результаты линтинга сохранены в change_log', 'CommandHandler');
        } catch (logError) {
          logger.warn('Не удалось сохранить результаты линтинга в change_log', 'CommandHandler');
        }
      }

      return {
        success: true,
        message: lines.join('\n'),
        data: {
          target: targetPath,
          results: lintResults,
          summary: { totalErrors, totalWarnings, fileCount: lintResults.length },
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Ошибка запуска ESLint: ' + errorMessage,
      };
    }
  }

  private escapeTableCell(text: string): string {
    // Экранируем символы для таблицы Markdown
    return text.replace(/\|/g, '\\|').replace(/\n/g, ' ').replace(/\r/g, '');
  }

  private getLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      json: 'json',
      md: 'markdown',
      html: 'html',
      css: 'css',
      sql: 'sql',
      sh: 'bash',
      bash: 'bash',
    };
    return langMap[ext || ''] || 'text';
  }
}
