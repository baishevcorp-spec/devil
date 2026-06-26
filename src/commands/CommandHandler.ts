import { logger } from '../utils/logger';
import { FileSystemService } from '../services/FileSystemService';
import { LLMProvider } from '../services/LLMProvider';
import { ContextBuilder } from '../services/ContextBuilder';
import { ProjectManager } from '../services/ProjectManager';

/**
 * Результат выполнения команды.
 */
export interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

/**
 * CommandHandler — обработка команд из чата.
 * 
 * Парсит команды вида /command [args] и вызывает соответствующие сервисы.
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

  /**
   * Обрабатывает сообщение пользователя.
   * Если это команда (начинается с /), парсит и выполняет её.
   * Иначе возвращает null (обычное сообщение).
   */
  async handleMessage(message: string): Promise<CommandResult | null> {
    const trimmed = message.trim();
    
    // Проверяем, является ли сообщение командой
    if (!trimmed.startsWith('/')) {
      return null;
    }

    // Парсим команду
    const parts = trimmed.split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    logger.info('Обработка команды: ' + command + ' ' + args.join(' '), 'CommandHandler');

    // Маршрутизация команд
    switch (command) {
      case '/scan':
        return await this.handleScan(args);
      case '/roadmap':
        return await this.handleRoadmap(args);
      case '/checklist':
        return await this.handleChecklist(args);
      case '/explain':
        return await this.handleExplain(args);
      case '/help':
        return this.handleHelp();
      default:
        return {
          success: false,
          message: 'Неизвестная команда: ' + command + '\n\nВведите /help для списка доступных команд.'
        };
    }
  }

  /**
   * Команда /scan [path] — чтение файла по пути.
   */
  private async handleScan(args: string[]): Promise<CommandResult> {
    if (args.length === 0) {
      return {
        success: false,
        message: 'Использование: /scan <путь_к_файлу>\n\nПример: /scan src/extension.ts'
      };
    }

    const filePath = args.join(' ');
    const project = this.projectManager.getCurrentProject();
    
    if (!project) {
      return {
        success: false,
        message: 'Проект не открыт. Используйте команду "Devil: Open Project".'
      };
    }

    const fullPath = project.path + '/' + filePath;

    try {
      const exists = await this.fileSystemService.fileExists(fullPath);
      if (!exists) {
        return {
          success: false,
          message: 'Файл не найден: ' + filePath
        };
      }

      const content = await this.fileSystemService.readFile(fullPath);
      
      return {
        success: true,
        message: '## Содержимое файла: ' + filePath + '\n\n```' + this.getLanguage(filePath) + '\n' + content + '\n```',
        data: { path: filePath, content }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Ошибка чтения файла: ' + errorMessage
      };
    }
  }

  /**
   * Команда /roadmap generate — генерация плана проекта.
   */
  private async handleRoadmap(args: string[]): Promise<CommandResult> {
    if (args.length === 0 || args[0] !== 'generate') {
      return {
        success: false,
        message: 'Использование: /roadmap generate\n\nСгенерирует план проекта на основе структуры файлов.'
      };
    }

    const project = this.projectManager.getCurrentProject();
    if (!project) {
      return {
        success: false,
        message: 'Проект не открыт.'
      };
    }

    try {
      // Строим контекст
      const context = await this.contextBuilder.buildContext('Сгенерируй подробный Roadmap для этого проекта', {
        includeProjectStructure: true,
        includeRoadmap: false,
        includeChecklist: false
      });

      // Промпт для генерации Roadmap
      const prompt = `Ты — опытный технический директор. Проанализируй структуру проекта и создай подробный Roadmap разработки.

Структура проекта:
${context.systemPrompt}

Создай Roadmap в формате Markdown с:
1. Кратким описанием проекта
2. Основными этапами разработки (с датами)
3. Ключевыми модулями и их зависимостями
4. Рисками и митигациями
5. Критериями готовности для каждого этапа

Отвечай на русском языке.`;

      const response = await this.llmProvider.generate(prompt, {
        systemPrompt: context.systemPrompt
      });

      // Сохраняем в .devil/roadmap.md
      const roadmapPath = project.devilPath + '/roadmap.md';
      await this.fileSystemService.writeFile(roadmapPath, response.content);

      return {
        success: true,
        message: '✅ Roadmap сгенерирован и сохранён в `.devil/roadmap.md`\n\n' + response.content,
        data: { path: roadmapPath, content: response.content }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Ошибка генерации Roadmap: ' + errorMessage
      };
    }
  }

  /**
   * Команда /checklist generate — генерация чек-листа.
   */
  private async handleChecklist(args: string[]): Promise<CommandResult> {
    if (args.length === 0 || args[0] !== 'generate') {
      return {
        success: false,
        message: 'Использование: /checklist generate\n\nСгенерирует чек-лист файлов проекта.'
      };
    }

    const project = this.projectManager.getCurrentProject();
    if (!project) {
      return {
        success: false,
        message: 'Проект не открыт.'
      };
    }

    try {
      const context = await this.contextBuilder.buildContext('Создай чек-лист файлов', {
        includeProjectStructure: true
      });

      const prompt = `Ты — опытный разработчик. Создай чек-лист файлов проекта в формате Markdown.

Структура проекта:
${context.systemPrompt}

Для каждого файла укажи:
- Путь к файлу
- Краткое описание назначения
- Статус (✅ реализован / ⏳ в разработке / ❌ не начато)

Формат:
- [ ] \`путь/к/файлу\` — описание

Отвечай на русском языке.`;

      const response = await this.llmProvider.generate(prompt, {
        systemPrompt: context.systemPrompt
      });

      const checklistPath = project.devilPath + '/checklist.md';
      await this.fileSystemService.writeFile(checklistPath, response.content);

      return {
        success: true,
        message: '✅ Чек-лист сгенерирован и сохранён в `.devil/checklist.md`\n\n' + response.content,
        data: { path: checklistPath, content: response.content }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Ошибка генерации чек-листа: ' + errorMessage
      };
    }
  }

  /**
   * Команда /explain [file] — объяснение кода.
   */
  private async handleExplain(args: string[]): Promise<CommandResult> {
    if (args.length === 0) {
      return {
        success: false,
        message: 'Использование: /explain <путь_к_файлу>\n\nПример: /explain src/extension.ts'
      };
    }

    const filePath = args.join(' ');
    const project = this.projectManager.getCurrentProject();
    
    if (!project) {
      return {
        success: false,
        message: 'Проект не открыт.'
      };
    }

    const fullPath = project.path + '/' + filePath;

    try {
      const exists = await this.fileSystemService.fileExists(fullPath);
      if (!exists) {
        return {
          success: false,
          message: 'Файл не найден: ' + filePath
        };
      }

      const content = await this.fileSystemService.readFile(fullPath);
      const context = await this.contextBuilder.buildContext('Объясни код', {
        includeProjectStructure: true
      });

      const prompt = `Ты — опытный разработчик. Объясни следующий код на русском языке.

Файл: ${filePath}

\`\`\`${this.getLanguage(filePath)}
${content}
\`\`\`

Объясни:
1. Что делает этот код
2. Основные функции/классы и их назначение
3. Ключевые моменты и паттерны
4. Возможные улучшения

Будь краток и по делу.`;

      const response = await this.llmProvider.generate(prompt, {
        systemPrompt: context.systemPrompt
      });

      return {
        success: true,
        message: '## Объяснение кода: ' + filePath + '\n\n' + response.content,
        data: { path: filePath, explanation: response.content }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Ошибка объяснения кода: ' + errorMessage
      };
    }
  }

  /**
   * Команда /help — список команд.
   */
  private handleHelp(): CommandResult {
    return {
      success: true,
      message: `## Доступные команды

**Файлы:**
- \`/scan <путь>\` — прочитать содержимое файла
- \`/explain <путь>\` — объяснить код файла

**Планирование:**
- \`/roadmap generate\` — сгенерировать план проекта
- \`/checklist generate\` — сгенерировать чек-лист файлов

**Другое:**
- \`/help\` — показать этот список

Все команды начинаются с \`/\` и вводятся в чат.`
    };
  }

  /**
   * Определяет язык программирования по расширению файла.
   */
  private getLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      'ts': 'typescript',
      'tsx': 'typescript',
      'js': 'javascript',
      'jsx': 'javascript',
      'py': 'python',
      'json': 'json',
      'md': 'markdown',
      'html': 'html',
      'css': 'css',
      'sql': 'sql',
      'sh': 'bash',
      'bash': 'bash'
    };
    return langMap[ext || ''] || 'text';
  }
}
