import { GraphNode } from './IMemoryStore';

export interface IEmbeddingService {
  /**
   * Инициализирует сервис и загружает ML-модель
   */
  initialize(): Promise<void>;

  /**
   * Генерирует векторное представление текста
   * @returns Float32Array размерностью 384
   */
  generateEmbedding(text: string): Promise<Float32Array>;

  /**
   * Вычисляет косинусное сходство между двумя векторами
   * @returns число от -1 до 1 (1 = идентичны)
   */
  cosineSimilarity(a: Float32Array, b: Float32Array): number;

  /**
   * Формирует текст для векторизации узла графа
   * Использует name, path, why, how_to_apply
   */
  buildEmbeddingText(node: GraphNode): string;
}
