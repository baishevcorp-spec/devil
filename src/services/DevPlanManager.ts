import * as path from 'path';
import * as crypto from 'crypto';
import { FileSystemService } from './FileSystemService';
import { LLMProvider } from './LLMProvider';
import { ProjectManager } from './ProjectManager';
import { ContextBuilder } from './ContextBuilder';
import { DevPlan, DevStep, DevPlanGenerationResult, DevStepType } from '../interfaces/IDevPlan';
import { InterviewData, validateInterview } from '../interfaces/IInterview';
import { logger } from '../utils/logger';

/**
 * DevPlanManager — сервис для управления планом разработки
 *
 * Отвечает за:
 * - Сбор контекста (interview, roadmap, checklist, graph)
 * - Формирование ТЗ через LLM
 * - Генерацию плана (список шагов)
 * - Сохранение плана в .devil/dev-plan.json
 */
export class DevPlanManager {
  private planPath: string = '';
  private currentPlan: DevPlan | null = null;

  constructor(
    private fileSystemService: FileSystemService,
    private llmProvider: LLMProvider,
    private projectManager: ProjectManager,
    private contextBuilder: ContextBuilder
  ) {}

  /**
   * Инициализирует DevPlanManager для текущего проекта
   */
  async initialize(projectPath: string): Promise<void> {
    this.planPath = path.join(projectPath, '.devil', 'dev-plan.json');
    await this.loadPlan();
    logger.info('DevPlanManager инициализирован', 'DevPlanManager');
  }

  /**
   * Загружает план из файла
   */
  private async loadPlan(): Promise<void> {
    const exists = await this.fileSystemService.fileExists(this.planPath);
    if (!exists) {
      this.currentPlan = null;
      return;
    }

    try {
      const content = await this.fileSystemService.readFile(this.planPath);
      this.currentPlan = JSON.parse(content) as DevPlan;
      logger.info('План загружен из файла', 'DevPlanManager');
    } catch (error) {
      logger.error('Не удалось загрузить план', error, 'DevPlanManager');
      this.currentPlan = null;
    }
  }

  /**
   * Сохраняет план в файл
   */
  private async savePlan(): Promise<void> {
    if (!this.currentPlan) return;

    try {
      const content = JSON.stringify(this.currentPlan, null, 2);
      await this.fileSystemService.writeFile(this.planPath, content);
      logger.info('План сохранён в файл', 'DevPlanManager');
    } catch (error) {
      logger.error('Не удалось сохранить план', error, 'DevPlanManager');
      throw error;
    }
  }

  /**
   * Генерирует новый план разработки
   */
  async generatePlan(): Promise<DevPlanGenerationResult> {
    const project = this.projectManager.getCurrentProject();
    if (!project) {
      return {
        success: false,
        error: 'Проект не открыт'
      };
    }

    try {
      logger.info('Начало генерации плана разработки', 'DevPlanManager');

      // 1. Собираем контекст
      const context = await this.collectContext(project.devilPath);

      // 2. Формируем промпт для LLM
      const prompt = this.buildGenerationPrompt(context);

      // 3. Генерируем план через LLM
      const response = await this.llmProvider.generate(prompt, {
        systemPrompt: context.systemPrompt,
        maxTokens: 8000
      });

      // 4. Парсим ответ LLM в структуру DevPlan
      const steps = this.parseLLMResponse(response.content);

      // 5. Создаём объект плана
      const plan: DevPlan = {
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'draft',
        totalSteps: steps.length,
        completedSteps: 0,
        steps,
        context: {
          interviewData: context.interviewData,
          roadmapContent: context.roadmapContent,
          checklistContent: context.checklistContent
        }
      };

      this.currentPlan = plan;
      await this.savePlan();

      logger.info(`План сгенерирован: ${steps.length} шагов`, 'DevPlanManager');

      return {
        success: true,
        plan,
        message: `✅ План разработки сгенерирован (${steps.length} шагов)`
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Ошибка генерации плана', error, 'DevPlanManager');
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Собирает контекст из всех источников
   */
  private async collectContext(devilPath: string): Promise<{
    interviewData: InterviewData | null;
    roadmapContent: string | null;
    checklistContent: string | null;
    systemPrompt: string;
  }> {
    // 1. Читаем interview.json
    let interviewData: InterviewData | null = null;
    const interviewPath = path.join(devilPath, 'interview.json');
    if (await this.fileSystemService.fileExists(interviewPath)) {
      try {
        const content = await this.fileSystemService.readFile(interviewPath);
        const parsed = JSON.parse(content);
        if (validateInterview(parsed)) {
          interviewData = parsed;
        }
      } catch (error) {
        logger.warn('Не удалось прочитать interview.json', 'DevPlanManager');
      }
    }

    // 2. Читаем roadmap.md
    let roadmapContent: string | null = null;
    const roadmapPath = path.join(devilPath, 'roadmap.md');
    if (await this.fileSystemService.fileExists(roadmapPath)) {
      roadmapContent = await this.fileSystemService.readFile(roadmapPath);
    }

    // 3. Читаем checklist.md
    let checklistContent: string | null = null;
    const checklistPath = path.join(devilPath, 'checklist.md');
    if (await this.fileSystemService.fileExists(checklistPath)) {
      checklistContent = await this.fileSystemService.readFile(checklistPath);
    }

    // 4. Строим системный промпт
    const systemPrompt = await this.contextBuilder.buildContext('Генерация плана разработки', {
      includeProjectStructure: true,
      includeRoadmap: true,
      includeChecklist: true,
      includeMemoryGraph: true,
      includeUserProfile: true
    });

    return {
      interviewData,
      roadmapContent,
      checklistContent,
      systemPrompt: systemPrompt.systemPrompt
    };
  }

  /**
   * Формирует промпт для генерации плана
   */
  private buildGenerationPrompt(context: {
    interviewData: InterviewData | null;
    roadmapContent: string | null;
    checklistContent: string | null;
    systemPrompt: string;
  }): string {
    let prompt = 'Ты — опытный архитектор и техлид. Создай детальный план разработки проекта.\n\n';

    if (context.interviewData) {
      prompt += '## Информация о проекте\n\n';
      prompt += `**Название:** ${context.interviewData.projectName}\n`;
      prompt += `**Описание:** ${context.interviewData.description}\n`;
      prompt += `**Цели:**\n${context.interviewData.goals.map(g => `- ${g}`).join('\n')}\n`;
      prompt += `**Технологии:** ${context.interviewData.techStack.join(', ')}\n`;
      prompt += `**Целевая аудитория:** ${context.interviewData.targetAudience}\n`;
      prompt += `**Сроки:** ${context.interviewData.deadlines}\n\n`;
    }

    if (context.roadmapContent) {
      prompt += '## Roadmap проекта\n\n' + context.roadmapContent + '\n\n';
    }

    if (context.checklistContent) {
      prompt += '## Чек-лист файлов\n\n';
      prompt += 'Файлы, отмеченные как `[x]`, уже существуют в проекте. НЕ включай их в план.\n\n';
      prompt += context.checklistContent + '\n\n';
    }

    prompt += '## Задача\n\n';
    prompt += 'Создай пошаговый план разработки в формате JSON массива.\n\n';
    prompt += '**ВАЖНО:**\n';
    prompt += '1. НЕ включай в план файлы и директории, которые уже существуют в проекте.\n';
    prompt += '2. Если файл отмечен как `[x]` в чек-листе — он уже создан, не включай его.\n';
    prompt += '3. Если директория уже есть в структуре проекта — не включай её в план.\n';
    prompt += '4. Включай в план только то, что нужно создать с нуля.\n\n';
    prompt += 'Каждый шаг должен иметь:\n';
    prompt += '- `id`: номер шага (начинается с 1)\n';
    prompt += '- `type`: тип шага ("create_directory", "create_file", "modify_file", "delete_file")\n';
    prompt += '- `path`: путь к файлу/директории (относительно корня проекта)\n';
    prompt += '- `description`: краткое описание того, что нужно сделать\n';
    prompt += '- `dependencies`: массив ID шагов, от которых зависит этот шаг (опционально)\n\n';
    prompt += 'Правила:\n';
    prompt += '1. Сначала создавай директории, потом файлы\n';
    prompt += '2. Учитывай зависимости между файлами (например, интерфейсы перед реализацией)\n';
    prompt += '3. Группируй связанные файлы вместе\n';
    prompt += '4. Будь конкретным в описаниях\n\n';
    prompt += 'Верни ТОЛЬКО JSON массив шагов, без пояснений.\n\n';
    prompt += 'Пример:\n';
    prompt += '```json\n';
    prompt += '[\n';
    prompt += '  {\n';
    prompt += '    "id": 1,\n';
    prompt += '    "type": "create_directory",\n';
    prompt += '    "path": "src/services",\n';
    prompt += '    "description": "Создать директорию для сервисов"\n';
    prompt += '  },\n';
    prompt += '  {\n';
    prompt += '    "id": 2,\n';
    prompt += '    "type": "create_file",\n';
    prompt += '    "path": "src/services/UserService.ts",\n';
    prompt += '    "description": "Создать сервис для работы с пользователями",\n';
    prompt += '    "dependencies": [1]\n';
    prompt += '  }\n';
    prompt += ']\n';
    prompt += '```\n';

    return prompt;
  }

  /**
   * Парсит ответ LLM в массив шагов
   */
  private parseLLMResponse(content: string): DevStep[] {
    try {
      // Ищем JSON в ответе
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        const steps = JSON.parse(jsonMatch[1]) as DevStep[];
        return steps.map((step, index) => ({
          ...step,
          id: step.id || index + 1,
          status: 'pending' as const
        }));
      }

      // Если нет JSON блока, пробуем парсить весь ответ
      const steps = JSON.parse(content) as DevStep[];
      return steps.map((step, index) => ({
        ...step,
        id: step.id || index + 1,
        status: 'pending' as const
      }));
    } catch (error) {
      logger.error('Не удалось парсить ответ LLM', error, 'DevPlanManager');
      throw new Error('Не удалось распарсить план из ответа LLM');
    }
  }

  /**
   * Получает текущий план
   */
  getCurrentPlan(): DevPlan | null {
    return this.currentPlan;
  }

  /**
   * Получает следующий шаг для выполнения
   */
  getNextStep(): DevStep | null {
    if (!this.currentPlan) return null;

    const pendingStep = this.currentPlan.steps.find(step => {
      if (step.status !== 'pending') return false;

      // Проверяем зависимости
      if (step.dependencies && step.dependencies.length > 0) {
        return step.dependencies.every(depId => {
          const depStep = this.currentPlan!.steps.find(s => s.id === depId);
          return depStep && depStep.status === 'completed';
        });
      }

      return true;
    });

    return pendingStep || null;
  }

  /**
   * Обновляет статус шага
   */
  async updateStepStatus(stepId: number, status: DevStep['status']): Promise<void> {
    if (!this.currentPlan) {
      throw new Error('План не загружен');
    }

    const step = this.currentPlan.steps.find(s => s.id === stepId);
    if (!step) {
      throw new Error(`Шаг ${stepId} не найден`);
    }

    step.status = status;
    if (status === 'completed') {
      step.completedAt = Date.now();
      this.currentPlan.completedSteps++;
    }

    // Обновляем статус плана
    if (this.currentPlan.completedSteps === this.currentPlan.totalSteps) {
      this.currentPlan.status = 'completed';
    } else if (this.currentPlan.completedSteps > 0) {
      this.currentPlan.status = 'in_progress';
    }

    this.currentPlan.updatedAt = Date.now();
    await this.savePlan();
  }

  /**
   * Сбрасывает план
   */
  async resetPlan(): Promise<void> {
    this.currentPlan = null;
    const exists = await this.fileSystemService.fileExists(this.planPath);
    if (exists) {
      await this.fileSystemService.deleteFile(this.planPath);
    }
    logger.info('План сброшен', 'DevPlanManager');
  }
}
