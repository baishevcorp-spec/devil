import * as path from 'path';
import { execSync } from 'child_process';
import * as fs from 'fs';
import { FileSystemService } from './FileSystemService';
import { LLMProvider } from './LLMProvider';
import { ContextBuilder } from './ContextBuilder';
import { DevPlanManager } from './DevPlanManager';
import { DevStep, DevStepExecutionResult } from '../interfaces/IDevPlan';
import { logger } from '../utils/logger';

/**
 * DevPlanExecutor — сервис для выполнения шагов плана разработки
 *
 * Отвечает за:
 * - Создание директорий
 * - Создание файлов с бэкапом
 * - Генерацию кода через LLM
 * - Обновление статуса шага
 */

/**
 * Контекст reference-файлов для генерации
 */
interface ReferenceContext {
  loaded: ReferenceFile[];
  missing: string[];
}

/**
 * Загруженный reference-файл
 */
interface ReferenceFile {
  path: string;
  content: string;
}

export class DevPlanExecutor {
  constructor(
    private fileSystemService: FileSystemService,
    private llmProvider: LLMProvider,
    private contextBuilder: ContextBuilder,
    private devPlanManager: DevPlanManager
  ) {}

  /**
   * Выполняет следующий шаг плана
   */
  async executeNextStep(projectPath: string): Promise<DevStepExecutionResult> {
    const plan = this.devPlanManager.getCurrentPlan();
    if (!plan) {
      return {
        success: false,
        error: 'План разработки не найден. Выполните /dev generate',
      };
    }

    const nextStep = this.devPlanManager.getNextStep();
    if (!nextStep) {
      return {
        success: false,
        error: 'Все шаги выполнены или заблокированы зависимостями',
      };
    }

    logger.info(`Выполнение шага ${nextStep.id}: ${nextStep.description}`, 'DevPlanExecutor');

    try {
      // Обновляем статус на "in_progress"
      await this.devPlanManager.updateStepStatus(nextStep.id, 'in_progress');

      let result: DevStepExecutionResult;

      switch (nextStep.type) {
        case 'create_directory':
          result = await this.createDirectory(nextStep, projectPath);
          break;
        case 'create_file':
          result = await this.createFile(nextStep, projectPath);
          break;
        case 'modify_file':
          result = await this.modifyFile(nextStep, projectPath);
          break;
        case 'delete_file':
          result = await this.deleteFile(nextStep, projectPath);
          break;
        default:
          result = {
            success: false,
            error: `Неизвестный тип шага: ${(nextStep as DevStep).type}`,
          };
      }

      if (result.success) {
        // Обновляем статус на "completed"
        await this.devPlanManager.updateStepStatus(nextStep.id, 'completed');
      } else {
        // Возвращаем статус "pending" при ошибке
        await this.devPlanManager.updateStepStatus(nextStep.id, 'pending');
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Ошибка выполнения шага ${nextStep.id}`, error, 'DevPlanExecutor');

      // Возвращаем статус "pending" при ошибке
      await this.devPlanManager.updateStepStatus(nextStep.id, 'pending');

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Создаёт директорию
   */
  private async createDirectory(
    step: DevStep,
    projectPath: string
  ): Promise<DevStepExecutionResult> {
    const dirPath = path.join(projectPath, step.path);

    try {
      await fs.promises.mkdir(dirPath, { recursive: true });
      logger.info(`Директория создана: ${step.path}`, 'DevPlanExecutor');

      return {
        success: true,
        step,
        message: `✅ Директория создана: \`${step.path}\``,
        commands: [],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Не удалось создать директорию: ${errorMessage}`,
      };
    }
  }

  /**
   * Создаёт файл с генерацией кода через LLM
   */
  private async createFile(step: DevStep, projectPath: string): Promise<DevStepExecutionResult> {
    const filePath = path.join(projectPath, step.path);

    try {
      // Проверяем, существует ли файл
      const exists = await this.fileSystemService.fileExists(filePath);
      let backupPath: string | undefined;

      if (exists) {
        // Создаём бэкап
        const timestamp = Date.now();
        backupPath = `${filePath}.${timestamp}.bak`;
        await fs.promises.copyFile(filePath, backupPath);
        logger.info(`Создан бэкап: ${backupPath}`, 'DevPlanExecutor');
      }

      // Загружаем reference-файлы
      const refContext = await this.loadReferenceFiles(step, projectPath);

      // Генерируем код через LLM с учётом reference-файлов
      const code = await this.generateCodeForFile(step, refContext);

      // Создаём директорию если нужно
      const dirPath = path.dirname(filePath);
      await fs.promises.mkdir(dirPath, { recursive: true });

      // Записываем файл
      await fs.promises.writeFile(filePath, code);
      logger.info(`Файл создан: ${step.path}`, 'DevPlanExecutor');

      // Автоформатирование через Prettier (если установлен)
      try {
        // execSync будет импортирован через import
        execSync(`npx prettier --write "${filePath}"`, { stdio: 'pipe' });
        logger.info(`Файл отформатирован: ${step.path}`, 'DevPlanExecutor');
      } catch (error) {
        logger.warn('Prettier не установлен, пропускаем форматирование', 'DevPlanExecutor');
      }

      // Формируем команды для проверки
      const commands = this.generateCommandsForFile(step.path);

      // Формируем сообщение с отчётом о reference-файлах
      let message = `✅ Файл создан: \`${step.path}\`\n\n${step.description}`;

      const refReport = this.formatReferenceReport(refContext);
      if (refReport) {
        message += '\n\n' + refReport;
      }

      return {
        success: true,
        step,
        message,
        backupPath,
        commands,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Не удалось создать файл: ${errorMessage}`,
      };
    }
  }

  /**
   * Модифицирует файл
   */
  private async modifyFile(step: DevStep, projectPath: string): Promise<DevStepExecutionResult> {
    const filePath = path.join(projectPath, step.path);

    try {
      // Создаём бэкап
      const timestamp = Date.now();
      const backupPath = `${filePath}.${timestamp}.bak`;
      await fs.promises.copyFile(filePath, backupPath);

      // Загружаем reference-файлы
      const refContext = await this.loadReferenceFiles(step, projectPath);

      // Генерируем новый код
      const code = await this.generateCodeForFile(step, refContext);

      // Записываем файл
      await fs.promises.writeFile(filePath, code);

      const commands = this.generateCommandsForFile(step.path);

      return {
        success: true,
        step,
        message: `✅ Файл обновлён: \`${step.path}\``,
        backupPath,
        commands,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Не удалось обновить файл: ${errorMessage}`,
      };
    }
  }

  /**
   * Удаляет файл
   */
  private async deleteFile(step: DevStep, projectPath: string): Promise<DevStepExecutionResult> {
    const filePath = path.join(projectPath, step.path);

    try {
      // Создаём бэкап
      const timestamp = Date.now();
      const backupPath = `${filePath}.${timestamp}.bak`;
      await fs.promises.copyFile(filePath, backupPath);

      // Удаляем файл
      await fs.promises.unlink(filePath);

      return {
        success: true,
        step,
        message: `✅ Файл удалён: \`${step.path}\``,
        backupPath,
        commands: [],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Не удалось удалить файл: ${errorMessage}`,
      };
    }
  }

  /**
   * Загружает содержимое reference-файлов для шага.
   * Объединяет globalReferences и step.referenceFiles с дедупликацией.
   */
  private async loadReferenceFiles(step: DevStep, projectPath: string): Promise<ReferenceContext> {
    const plan = this.devPlanManager.getCurrentPlan();

    const allPaths = [...(plan?.globalReferences || []), ...(step.referenceFiles || [])];

    // Дедупликация
    const uniquePaths = [...new Set(allPaths)];

    const loaded: ReferenceFile[] = [];
    const missing: string[] = [];

    for (const refPath of uniquePaths) {
      const fullPath = path.join(projectPath, refPath);
      const exists = await this.fileSystemService.fileExists(fullPath);

      if (exists) {
        try {
          const content = await this.fileSystemService.readFile(fullPath);
          loaded.push({ path: refPath, content });
          logger.info(`Reference-файл загружен: ${refPath}`, 'DevPlanExecutor');
        } catch (error) {
          logger.error(`Ошибка чтения reference-файла: ${refPath}`, error, 'DevPlanExecutor');
          missing.push(refPath);
        }
      } else {
        missing.push(refPath);
        logger.warn(`Reference-файл не найден: ${refPath}`, 'DevPlanExecutor');
      }
    }

    return { loaded, missing };
  }

  /**
   * Формирует сообщение о загруженных reference-файлах для чата.
   */
  private formatReferenceReport(refContext: ReferenceContext): string {
    const lines: string[] = [];

    if (refContext.loaded.length > 0) {
      lines.push('📚 **Учтены reference-файлы:**');
      for (const file of refContext.loaded) {
        const sizeKB = (file.content.length / 1024).toFixed(1);
        lines.push(`  ✅ \`${file.path}\` (${sizeKB} КБ)`);
      }
    }

    if (refContext.missing.length > 0) {
      lines.push('\n⚠️ **Отсутствующие reference-файлы:**');
      for (const path of refContext.missing) {
        lines.push(`  ❌ \`${path}\``);
      }
    }

    return lines.join('\n');
  }

  /**
   * Генерирует код для файла через LLM
   */
  private async generateCodeForFile(step: DevStep, refContext: ReferenceContext): Promise<string> {
    const context = await this.contextBuilder.buildContext(
      `Сгенерируй код для файла: ${step.path}. ${step.description}`,
      {
        includeProjectStructure: true,
        includeRoadmap: true,
        includeChecklist: true,
        includeMemoryGraph: true,
      }
    );

    let prompt = '';

    // 1. Reference-файлы (контекст)
    if (refContext.loaded.length > 0) {
      prompt += '# 📚 Контекст проекта (reference-файлы)\n\n';
      prompt += '**ОБЯЗАТЕЛЬНО учитывай эти файлы при генерации кода.**\n\n';

      for (const file of refContext.loaded) {
        prompt += `## ${file.path}\n\n`;
        prompt += '```\n';
        prompt += file.content;
        prompt += '\n```\n\n---\n\n';
      }
    }

    // 2. Задача
    prompt += `# Задача\n\n`;
    prompt += `Создай ПРОДАКШЕН-ГОТОВЫЙ код для файла \`${step.path}\`.\n\n`;
    prompt += `**Описание:** ${step.description}\n\n`;

    // 3. Context hints (дополнительные указания)
    if (step.contextHints && Object.keys(step.contextHints).length > 0) {
      prompt += `# Дополнительные указания\n\n`;
      for (const [key, value] of Object.entries(step.contextHints)) {
        prompt += `- **${key}:** ${value}\n`;
      }
      prompt += '\n';
    }

    // 4. Строгие требования (сохраняем существующие)
    prompt += '⛔ **СТРОГИЕ ЗАПРЕТЫ (нарушение = ошибка):**\n';
    prompt += '- НИКАКОГО `any`. Используй точные типы, интерфейсы, `unknown` или дженерики.\n';
    prompt +=
      '- НИКАКИХ неиспользуемых переменных. Если переменная не используется, убери её или префиксируй с `_`.\n';
    prompt += '- НИКАКОГО `console.log`, `console.warn`, `console.error` в готовом коде.\n';
    prompt +=
      '- НИКАКИХ синтаксических ошибок в JSX/TSX (правильные закрывающие теги, типы пропсов).\n';
    prompt +=
      '- Соблюдай форматирование Prettier: точки с запятой, запятые после последних элементов, правильные отступы.\n\n';

    prompt += '✅ **ОБЯЗАТЕЛЬНО:**\n';
    prompt += '- Строгая типизация TypeScript\n';
    prompt += '- Функциональные компоненты React с явными типами пропсов (если это React-файл)\n';
    prompt += '- Корректная обработка ошибок (try/catch с использованием `err`)\n';
    prompt += '- Чистый код без лишних комментариев\n';
    prompt +=
      '- **Следуй принципам и паттернам из reference-файлов** (цвета, отступы, именование)\n\n';

    prompt +=
      'Верни ТОЛЬКО содержимое файла. НЕ оборачивай код в ```typescript или другие markdown-блоки.';

    const response = await this.llmProvider.generate(prompt, {
      systemPrompt: context.systemPrompt,
      maxTokens: 4000,
    });

    return response.content;
  }

  /**
   * Генерирует команды для проверки файла
   */
  private generateCommandsForFile(filePath: string): string[] {
    const ext = path.extname(filePath).toLowerCase();
    const commands: string[] = [];

    // Компиляция/проверка
    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
      commands.push('npm run compile');
      commands.push('npm run lint');
    }

    // Тесты
    if (filePath.includes('.test.') || filePath.includes('.spec.')) {
      commands.push('npm test');
    }

    // Git
    commands.push(`git add ${filePath}`);
    commands.push(`git commit -m "feat: add ${path.basename(filePath)}"`);

    return commands;
  }
}
