import { pipeline, env } from '@xenova/transformers';
import { IEmbeddingService } from '../interfaces/IEmbeddingService';
import { GraphNode } from '../interfaces/IMemoryStore';
import { logger } from '../utils/logger';
import * as path from 'path';
import * as os from 'os';

/**
 * EmbeddingService — сервис для генерации векторных представлений текста
 * Использует transformers.js и модель all-MiniLM-L6-v2 (384 dimensions)
 * 
 * Отвечает за:
 * - Загрузку и кэширование ML-модели
 * - Генерацию embeddings для текста
 * - Вычисление косинусного сходства
 * - Формирование текста для векторизации узлов графа
 */
export class EmbeddingService implements IEmbeddingService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractor: any = null;
  private isInitialized = false;
  private readonly MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
  private readonly MAX_TEXT_LENGTH = 512;

  /**
   * Инициализирует сервис и загружает модель
   * Модель кэшируется в ~/.devil/models/
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Настройка кэша моделей
    env.cacheDir = path.join(os.homedir(), '.devil', 'models');
    // Отключаем локальные модели, чтобы гарантированно скачать с HuggingFace
    env.allowLocalModels = false;

    logger.info('Загрузка модели для векторизации (первый запуск может занять 10-30 сек)...', 'EmbeddingService');
    
    try {
      this.extractor = await pipeline('feature-extraction', this.MODEL_NAME, {
        quantized: true, // Используем квантованную модель (INT8) для скорости
      });
      this.isInitialized = true;
      logger.info('Модель успешно загружена и готова к работе', 'EmbeddingService');
    } catch (error) {
      logger.error('Ошибка загрузки модели для векторизации', error, 'EmbeddingService');
      throw error;
    }
  }

  /**
   * Генерирует векторное представление текста
   * @param text - Текст для векторизации
   * @returns Float32Array размерностью 384
   */
  async generateEmbedding(text: string): Promise<Float32Array> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    if (!this.extractor) {
      throw new Error('Модель не инициализирована');
    }

    // Ограничиваем длину текста
    const truncatedText = text.length > this.MAX_TEXT_LENGTH 
      ? text.substring(0, this.MAX_TEXT_LENGTH) 
      : text;

    // Генерируем embedding
    // pooling: 'mean' — усредняем токены
    // normalize: true — нормализуем вектор (упрощает cosine similarity до dot product)
    const output = await this.extractor(truncatedText, {
      pooling: 'mean',
      normalize: true,
    });

    return output.data as Float32Array;
  }

  /**
   * Вычисляет косинусное сходство между двумя векторами
   * @param a - Первый вектор
   * @param b - Второй вектор
   * @returns число от -1 до 1 (1 = идентичны, 0 = ортогональны, -1 = противоположны)
   */
  cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error(`Размерности векторов не совпадают: ${a.length} vs ${b.length}`);
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
  }

  /**
   * Формирует текст для векторизации узла графа
   * Включает имя, путь, why, how_to_apply, description
   */
  buildEmbeddingText(node: GraphNode): string {
    const parts: string[] = [node.name];
    
    if (node.path) {
      parts.push(`File: ${node.path}`);
    }
    
    if (node.metadata?.why) {
      parts.push(`Why: ${node.metadata.why}`);
    }
    
    if (node.metadata?.how_to_apply) {
      parts.push(`How to apply: ${node.metadata.how_to_apply}`);
    }
    
    if (node.metadata?.description && typeof node.metadata.description === 'string') {
      parts.push(node.metadata.description);
    }

    return parts.join('. ');
  }
}
