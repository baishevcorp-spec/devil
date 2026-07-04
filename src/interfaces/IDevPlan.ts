/**
 * Тип шага в плане разработки
 */
export type DevStepType = 'create_directory' | 'create_file' | 'modify_file' | 'delete_file';

/**
 * Статус шага в плане разработки
 */
export type DevStepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

/**
 * Статус всего плана разработки
 */
export type DevPlanStatus = 'draft' | 'in_progress' | 'completed' | 'paused';

/**
 * Шаг в плане разработки
 */
export interface DevStep {
  id: number;
  type: DevStepType;
  path: string;
  description: string;
  status: DevStepStatus;
  dependencies?: number[];
  completedAt?: number;
  backupPath?: string;
  commands?: string[];
  metadata?: Record<string, unknown>;
  referenceFiles?: string[];
  contextHints?: Record<string, string>;
}

/**
 * План разработки
 */
export interface DevPlan {
  version: number;
  createdAt: number;
  updatedAt: number;
  status: DevPlanStatus;
  totalSteps: number;
  completedSteps: number;
  steps: DevStep[];
  context?: {
    interviewData?: import('./IInterview').InterviewData | null;
    roadmapContent?: string | null;
    checklistContent?: string | null;
  };
  globalReferences?: string[];
}

/**
 * Результат генерации плана
 */
export interface DevPlanGenerationResult {
  success: boolean;
  plan?: DevPlan;
  error?: string;
  message?: string;
}

/**
 * Результат выполнения шага
 */
export interface DevStepExecutionResult {
  success: boolean;
  step?: DevStep;
  error?: string;
  message?: string;
  commands?: string[];
  backupPath?: string;
}
