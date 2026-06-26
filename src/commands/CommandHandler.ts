import { logger } from '../utils/logger';
import { FileSystemService } from '../services/FileSystemService';
import { LLMProvider } from '../services/LLMProvider';
import { ContextBuilder } from '../services/ContextBuilder';
import { ProjectManager } from '../services/ProjectManager';

export interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

/**
 * CommandHandler — обработка команд из чата.
 *
 * Формат команд:
 *   /command arg1 arg2
 *   /command arg1 --- выделенный код
 *
 * Разделитель " --- " разделяет путь к файлу и выделенный код.
 */
export class CommandHandler {
  constructor(
    private readonly fileSystemService: FileSystemService,
    private readonly llmProvider: LLMProvider,
    private readonly contextBuilder: ContextBuilder,
    private readonly projectManager: ProjectManager
  ) {
    logger.info('CommandHandler инициализирован', 'CommandHandler');
  }

  async handleMessage(message: string): Promise<CommandResult | null> {
    const trimmed = message.trim();

    if (!trimmed.startsWith('/')) {
      return null;
    }

    // Разделяем команду и выделенный код через " --- "
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

    // Первый аргумент — путь к файлу
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
          'Использование: /roadmap generate\n\nСгенерирует план проекта на основе структуры файлов.',
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
      const context = await this.contextBuilder.buildContext(
        'Сгенерируй подробный Roadmap для этого проекта',
        {
          includeProjectStructure: true,
          includeRoadmap: false,
          includeChecklist: false,
        }
      );

      const prompt =
        'Ты — опытный технический директор. Проанализируй структуру проекта и создай подробный Roadmap разработки.\n\n' +
        'Структура проекта:\n' +
        context.systemPrompt +
        '\n\n' +
        'Создай Roadmap в формате Markdown с:\n' +
        '1. Кратким описанием проекта\n' +
        '2. Основными этапами разработки (с датами)\n' +
        '3. Ключевыми модулями и их зависимостями\n' +
        '4. Рисками и митигациями\n' +
        '5. Критериями готовности для каждого этапа\n\n' +
        'Отвечай на русском языке.';

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
        '- Статус (✅ реализован /  в разработке / ❌ не начато)\n\n' +
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

    // Первый аргумент — путь к файлу
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

      // Если есть выделенный код — объясняем только его
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

  private handleHelp(): CommandResult {
    const helpText = [
      '## Доступные команды',
      '',
      '**Файлы:**',
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
