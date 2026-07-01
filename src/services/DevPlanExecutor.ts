import * as path from 'path';
import * as fs from 'fs';
import { FileSystemService } from './FileSystemService';
import { LLMProvider } from './LLMProvider';
import { ContextBuilder } from './ContextBuilder';
import { DevPlanManager } from './DevPlanManager';
import { DevStep, DevStepExecutionResult, DevStepType } from '../interfaces/IDevPlan';
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
        error: 'План разработки не найден. Выполните /dev generate'
      };
    }

    const nextStep = this.devPlanManager.getNextStep();
    if (!nextStep) {
      return {
        success: false,
        error: 'Все шаги выполнены или заблокированы зависимостями'
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
            error: `Неизвестный тип шага: ${(nextStep as DevStep).type}`
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
        error: errorMessage
      };
    }
  }

  /**
   * Создаёт директорию
   */
  private async createDirectory(step: DevStep, projectPath: string): Promise<DevStepExecutionResult> {
    const dirPath = path.join(projectPath, step.path);

    try {
      await fs.promises.mkdir(dirPath, { recursive: true });
      logger.info(`Директория создана: ${step.path}`, 'DevPlanExecutor');

      return {
        success: true,
        step,
        message: `✅ Директория создана: \`${step.path}\``,
        commands: []
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Не удалось создать директорию: ${errorMessage}`
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

      // Генерируем код через LLM
      const code = await this.generateCodeForFile(step);

      // Создаём директорию если нужно
      const dirPath = path.dirname(filePath);
      await fs.promises.mkdir(dirPath, { recursive: true });

      // Записываем файл
      await fs.promises.writeFile(filePath, code);
      logger.info(`Файл создан: ${step.path}`, 'DevPlanExecutor');

      // Формируем команды для проверки
      const commands = this.generateCommandsForFile(step.path);

      return {
        success: true,
        step,
        message: `✅ Файл создан: \`${step.path}\`\n\n${step.description}`,
        backupPath,
        commands
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Не удалось создать файл: ${errorMessage}`
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

      // Генерируем новый код
      const code = await this.generateCodeForFile(step);

      // Записываем файл
      await fs.promises.writeFile(filePath, code);

      const commands = this.generateCommandsForFile(step.path);

      return {
        success: true,
        step,
        message: `✅ Файл обновлён: \`${step.path}\``,
        backupPath,
        commands
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Не удалось обновить файл: ${errorMessage}`
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
        commands: []
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Не удалось удалить файл: ${errorMessage}`
      };
    }
  }

  /**
   * Генерирует код для файла через LLM
   */
  private async generateCodeForFile(step: DevStep): Promise<string> {
    const context = await this.contextBuilder.buildContext(
      `Сгенерируй код для файла: ${step.path}. ${step.description}`,
      {
        includeProjectStructure: true,
        includeRoadmap: true,
        includeChecklist: true,
        includeMemoryGraph: true
      }
    );

    const prompt = `Создай код для файла \`${step.path}\`.

**Описание:** ${step.description}

**Требования:**
- Используй лучшие практики и паттерны
- Добавь комментарии для сложной логики
- Следуй существующему стилю кода в проекте
- Если файл зависит от других файлов, используй правильные импорты

Верни ТОЛЬКО код файла, без пояснений и markdown-блоков.`;

    const response = await this.llmProvider.generate(prompt, {
      systemPrompt: context.systemPrompt,
      maxTokens: 10000
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
