import { logger } from './logger';

/**
 * Этап из roadmap.md
 */
export interface RoadmapPhase {
  title: string;
  description: string;
  tasks: string[];
}

/**
 * Результат парсинга roadmap.md
 */
export interface ParsedRoadmap {
  title: string;
  phases: RoadmapPhase[];
  rawContent: string;
}

/**
 * RoadmapParser — утилитарный класс для парсинга roadmap.md
 *
 * Извлекает этапы (фазы) из Markdown-файла roadmap.md
 * для последующей передачи в промпт LLM при генерации чек-листа.
 *
 * @example
 * ```typescript
 * const parser = new RoadmapParser();
 * const roadmap = parser.parse(roadmapContent);
 * console.log(roadmap.phases); // [{ title: 'Фаза 1', tasks: [...] }, ...]
 * ```
 */
export class RoadmapParser {
  /**
   * Парсит содержимое roadmap.md и извлекает этапы.
   *
   * @param content - Содержимое файла roadmap.md
   * @returns Структурированный roadmap с этапами и задачами
   */
  parse(content: string): ParsedRoadmap {
    const result: ParsedRoadmap = {
      title: '',
      phases: [],
      rawContent: content
    };

    if (!content || content.trim().length === 0) {
      logger.warn('Roadmap пуст', 'RoadmapParser');
      return result;
    }

    const lines = content.split('\n');
    let currentPhase: RoadmapPhase | null = null;
    let inTasksSection = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Пропускаем пустые строки
      if (trimmed.length === 0) continue;

      // Заголовок H1 (# Название)
      if (trimmed.startsWith('# ') && !result.title) {
        result.title = trimmed.substring(2).trim();
        continue;
      }

      // Заголовок H2 (## Фаза 1: ...)
      if (trimmed.startsWith('## ')) {
        // Сохраняем предыдущую фазу
        if (currentPhase) {
          result.phases.push(currentPhase);
        }

        const phaseTitle = trimmed.substring(3).trim();
        currentPhase = {
          title: phaseTitle,
          description: '',
          tasks: []
        };
        inTasksSection = false;
        continue;
      }

      // Заголовок H3 (### Задачи / ### Этапы)
      if (trimmed.startsWith('### ')) {
        inTasksSection = true;
        continue;
      }

      // Если мы в секции задач и текущая строка — список (- или *)
      if (currentPhase && inTasksSection && (trimmed.startsWith('- ') || trimmed.startsWith('* '))) {
        const task = trimmed.substring(2).trim();
        if (task.length > 0) {
          currentPhase.tasks.push(task);
        }
        continue;
      }

      // Если мы в фазе и это обычный текст — добавляем к описанию
      if (currentPhase && !inTasksSection && !trimmed.startsWith('#')) {
        if (currentPhase.description.length > 0) {
          currentPhase.description += ' ';
        }
        currentPhase.description += trimmed;
      }
    }

    // Добавляем последнюю фазу
    if (currentPhase) {
      result.phases.push(currentPhase);
    }

    logger.info(`Roadmap распарсен: ${result.phases.length} фаз, ${result.phases.reduce((sum, p) => sum + p.tasks.length, 0)} задач`, 'RoadmapParser');

    return result;
  }

  /**
   * Форматирует roadmap в строку для промпта LLM.
   *
   * @param roadmap - Распарсенный roadmap
   * @returns Форматированная строка с этапами и задачами
   */
  formatForPrompt(roadmap: ParsedRoadmap): string {
    if (roadmap.phases.length === 0) {
      return '';
    }

    const lines: string[] = [];
    lines.push(`# ${roadmap.title || 'Roadmap проекта'}`);
    lines.push('');

    for (const phase of roadmap.phases) {
      lines.push(`## ${phase.title}`);
      if (phase.description) {
        lines.push(phase.description);
      }
      lines.push('');

      if (phase.tasks.length > 0) {
        lines.push('### Задачи:');
        for (const task of phase.tasks) {
          lines.push(`- ${task}`);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }
}
