/**
 * Интерфейс для структурированного интервью проекта
 */
export interface InterviewData {
  projectName: string;
  description: string;
  goals: string[];
  techStack: string[];
  targetAudience: string;
  deadlines: string;
  constraints: string[];
  additionalInfo?: string;
}

/**
 * Статус интервью
 */
export type InterviewStatus = 'pending' | 'filled' | 'roadmap_generated';

/**
 * Интерфейс для статуса интервью
 */
export interface InterviewStatusData {
  status: InterviewStatus;
  createdAt: number;
  updatedAt: number;
  interviewFile: string;
}

/**
 * Валидация интервью
 */
export function validateInterview(data: unknown): data is InterviewData {
  if (!data || typeof data !== 'object') return false;
  
  const obj = data as Record<string, unknown>;
  
  // Обязательные поля
  if (typeof obj.projectName !== 'string' || obj.projectName.trim() === '') return false;
  if (typeof obj.description !== 'string' || obj.description.trim() === '') return false;
  if (!Array.isArray(obj.goals) || obj.goals.length === 0) return false;
  if (!Array.isArray(obj.techStack) || obj.techStack.length === 0) return false;
  if (typeof obj.targetAudience !== 'string' || obj.targetAudience.trim() === '') return false;
  if (typeof obj.deadlines !== 'string' || obj.deadlines.trim() === '') return false;
  
  return true;
}
