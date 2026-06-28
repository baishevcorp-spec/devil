import { logger } from '../utils/logger';
import { FileSystemService } from '../services/FileSystemService';
import { LLMProvider } from '../services/LLMProvider';
import { ContextBuilder } from '../services/ContextBuilder';
import { ProjectManager } from '../services/ProjectManager';
import { IMemoryStore } from '../interfaces/IMemoryStore';
import { GitService } from '../services/GitService';
import { SearchIndex } from '../services/SearchIndex';
import * as child_process from 'child_process';
import * as util from 'util';
import * as path from 'path';

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
  projectStructure: any;
  projectPath: string;
}

export class CommandHandler {
  constructor(
    private readonly fileSystemService: FileSystemService,
    private readonly llmProvider: LLMProvider,
    private readonly contextBuilder: ContextBuilder,
    private readonly projectManager: ProjectManager,
    private readonly memoryStore: IMemoryStore,
    private readonly gitService: GitService,
    private readonly searchIndex: SearchIndex
  ) {
    logger.info('CommandHandler инициализирован', 'CommandHandler');
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
        return await this.handleRoadmap(args);
      case '/checklist':
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
      case '/view':
        return await this.handleView(args);
      case '/lint':
        return await this.handleLint(args);
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
          'Использование: /roadmap generate\n\nСгенерирует план проекта на основе структуры файлов или предложит создание проведя интервью.',
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
      // Анализ состояния проекта
      const projectAnalysis = await this.analyzeProjectState(project);

      // Получаем контекст в зависимости от состояния проекта
      const context = await this.buildRoadmapContext(project, projectAnalysis);

      // Строим промпт в зависимости от состояния проекта
      const prompt = this.buildRoadmapPrompt(project, projectAnalysis, context);

      const response = await this.llmProvider.generate(prompt, {
        systemPrompt: context.systemPrompt,
      });

      const roadmapPath = project.devilPath + '/roadmap.md';
      await this.fileSystemService.writeFile(roadmapPath, response.content);

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

  private async analyzeProjectState(project: any): Promise<ProjectAnalysis> {
    // Считаем файлы в проекте
    const allFiles = this.countProjectFiles(project.structure);

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
        const packageContent = await this.fileSystemService.readFile(project.path + '/package.json');
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
      projectPath: project.path
    };
  }

  private async buildRoadmapContext(_project: any, analysis: ProjectAnalysis): Promise<any> {
    // Определяем, сколько информации включать в контекст
    const includeOptions = {
      includeProjectStructure: analysis.totalFiles > 0,
      includeRoadmap: false,
      includeChecklist: false,
    };

    const userQuery = analysis.totalFiles === 0
      ? 'Это новый пустой проект. Нужно создать начальный Roadmap для разработки.'
      : 'Сгенерируй подробный Roadmap для этого проекта';

    return await this.contextBuilder.buildContext(userQuery, includeOptions);
  }

  private buildRoadmapPrompt(_project: any, analysis: ProjectAnalysis, context: any): string {
    // TODO: Здесь будет ваш промпт
    // Сейчас используем базовый промпт

    return (
      'Ты — опытный технический директор. Проанализируй состояние проекта и создай подробный Roadmap разработки.\n\n' +
      this.buildProjectSummary(analysis) +
      '\n\n' +
      'Контекст проекта:\n' +
      context.systemPrompt +
      '\n\n' +
      'Создай Roadmap в формате Markdown с:\n' +
      '1. Кратким описанием проекта\n' +
      '2. Основными этапами разработки (с датами)\n' +
      '3. Ключевыми модулями и их зависимостями\n' +
      '4. Рисками и митигациями\n' +
      '5. Критериями готовности для каждого этапа\n\n' +
      'Отвечай на русском языке.'
    );
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

    function traverse(node: any) {
      if (node.type === 'file') {
        count++;
      }
      if (node.children) {
        node.children.forEach(traverse);
      }
    }

    if (tree && tree.children) {
      tree.children.forEach(traverse);
    }

    return count;
  }

  private async handleChecklist(args: string[]): Promise<CommandResult> {
    if (args.length === 0 || args[0] !== 'generate') {
      return {
        success: false,
        message: 'Использование: /checklist generate\n\nСгенерирует чек-лист файлов проекта.',
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
      const context = await this.contextBuilder.buildContext('Создай чек-лист файлов', {
        includeProjectStructure: true,
      });

      const prompt =
        'Ты — опытный разработчик. Создай чек-лист файлов проекта в формате Markdown.\n\n' +
        'Структура проекта:\n' +
        context.systemPrompt +
        '\n\n' +
        'Для каждого файла укажи:\n' +
        '- Путь к файлу\n' +
        '- Краткое описание назначения\n' +
        '- Статус (✅ реализован / в разработке / не начато)\n\n' +
        'Формат:\n' +
        '- [ ] `путь/к/файлу` — описание\n\n' +
        'Отвечай на русском языке.';

      const response = await this.llmProvider.generate(prompt, {
        systemPrompt: context.systemPrompt,
      });

      const checklistPath = project.devilPath + '/checklist.md';
      await this.fileSystemService.writeFile(checklistPath, response.content);

      return {
        success: true,
        message:
          '✅ Чек-лист сгенерирован и сохранён в `.devil/checklist.md`\n\n' + response.content,
        data: { path: checklistPath, content: response.content },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Ошибка генерации чек-листа: ' + errorMessage,
      };
    }
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
      const results = await this.searchIndex.search(query, { limit: 50 });
      const duration = Date.now() - startTime;

      if (results.length === 0) {
        return {
          success: false,
          message: 'По запросу "' + query + '" ничего не найдено.\n\n' +
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
      lines.push('Найдено **' + results.length + '** совпадений в **' + Object.keys(byFile).length + '** файлах за ' + duration + 'мс');
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
      const nodes = await this.memoryStore.findNodes({ limit: 50 });

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

  private handleHelp(): CommandResult {
    const helpText = [
      '## Доступные команды',
      '',
      '**Поиск:**',
      '- `/search <запрос>` — поиск по содержимому файлов',
      '- `/whereis <символ>` — найти символ в проекте',
      '',
      '**Анализ кода:**',
      '- `/lint [путь]` — запустить ESLint для проверки кода',
      '',
      '**Файлы:**',
      '- `/git log [файл]` — показать историю коммитов',
      '- `/diff [commit]` — показать изменения в коде',
      '- `/memory show` — показать графовую память',
      '- `/view roadmap` — показать Roadmap проекта',
      '- `/view checklist` — показать чек-лист',
      '- `/scan <путь>` — прочитать содержимое файла',
      '- `/explain <путь>` — объяснить код файла',
      '',
      '**Планирование:**',
      '- `/roadmap generate` — сгенерировать план проекта',
      '- `/checklist generate` — сгенерировать чек-лист файлов',
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
      const targetPath = args.length > 0 ? args[0] : '.';
      const fullPath = path.join(project.path, targetPath);

      // Проверяем, существует ли файл/папка
      const exists = await this.fileSystemService.fileExists(fullPath);
      if (!exists) {
        return {
          success: false,
          message: 'Путь не найден: ' + targetPath,
        };
      }

      // Проверяем, установлен ли ESLint в проекте
      const eslintConfigPaths = [
        '.eslintrc.js',
        '.eslintrc.cjs',
        '.eslintrc.yaml',
        '.eslintrc.yml',
        '.eslintrc.json',
        '.eslintrc',
        'package.json' // ESLint может быть в package.json
      ];

      let eslintConfigFound = false;
      for (const configPath of eslintConfigPaths) {
        const configFullPath = path.join(project.path, configPath);
        if (await this.fileSystemService.fileExists(configFullPath)) {
          eslintConfigFound = true;
          break;
        }
      }

      if (!eslintConfigFound) {
        return {
          success: false,
          message: 'ESLint конфигурация не найдена в проекте.\n\n' +
            'Установите ESLint:\n' +
            '```bash\nnpm install --save-dev eslint\nnpx eslint --init\n```',
        };
      }

      logger.info('Запуск ESLint для: ' + targetPath, 'CommandHandler');

      // Запускаем ESLint с относительным путем
      const exec = util.promisify(child_process.exec);
      const command = `npx eslint "${targetPath}" --format json`;

      const { stdout, stderr } = await exec(command, {
        cwd: project.path,
        maxBuffer: 1024 * 1024 * 10 // 10 MB
      });

      if (stderr && !stdout) {
        // Если есть ошибка и нет вывода, значит ESLint не найден
        return {
          success: false,
          message: 'ESLint не найден или произошла ошибка.\n\n' +
            'Убедитесь, что ESLint установлен:\n' +
            '```bash\nnpm install --save-dev eslint\n```\n\n' +
            'Ошибка ESLint:\n' +
            '```\n' + stderr + '\n```',
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
      } catch (parseError) {
        // Если не удалось распарсить JSON, значит ESLint вернул пустой вывод (нет ошибок)
        if (stdout.trim() === '' && !stderr) {
          return {
            success: true,
            message: '✅ ESLint: Нет ошибок или предупреждений для ' + targetPath,
            data: { target: targetPath, results: [] }
          };
        }

        // Иначе это ошибка
        return {
          success: false,
          message: 'Не удалось распарсить вывод ESLint:\n```\n' + stdout + '\n```',
        };
      }

      // Форматируем резул��таты
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

          lines.push('| **[Строка ' + message.line + '](' + lineUrl + ')** | ' +
                     message.column + ' | ' + severity + ' | `' + ruleId + '` | ' +
                     this.escapeTableCell(message.message) + ' |');
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

      return {
        success: true,
        message: lines.join('\n'),
        data: {
          target: targetPath,
          results: lintResults,
          summary: { totalErrors, totalWarnings, fileCount: lintResults.length }
        }
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
