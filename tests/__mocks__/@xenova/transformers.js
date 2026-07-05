/**
 * Мок для @xenova/transformers
 * 
 * Имитирует работу библиотеки без реальной загрузки модели (80 МБ).
 * Используется в тестах EmbeddingService для изоляции от внешних зависимостей.
 */

// Фиксированный размер embedding для модели all-MiniLM-L6-v2
const DIMENSIONS = 384;

// Детерминированная хеш-функция для стабильных результатов тестов
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

// Генерирует детерминированный embedding на основе текста
// Одинаковые тексты → одинаковые векторы
// Похожие тексты → похожие векторы (через общую хеш-функцию)
function generateDeterministicEmbedding(text) {
  const embedding = new Float32Array(DIMENSIONS);
  const seed = hashString(text);
  
  // Простой PRNG на основе seed
  let state = seed;
  for (let i = 0; i < DIMENSIONS; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    embedding[i] = (state / 0x7fffffff) * 2 - 1; // диапазон [-1, 1]
  }
  
  // Нормализация вектора (как в реальной модели с normalize: true)
  let norm = 0;
  for (let i = 0; i < DIMENSIONS; i++) {
    norm += embedding[i] * embedding[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < DIMENSIONS; i++) {
      embedding[i] /= norm;
    }
  }
  
  return embedding;
}

// Мок для pipeline('feature-extraction', ...)
async function mockPipeline(task, modelName, options) {
  if (task !== 'feature-extraction') {
    throw new Error(`Unsupported task in mock: ${task}`);
  }
  
  // Возвращаем мок-экстрактор
  return async function extractor(text, options) {
    const embedding = generateDeterministicEmbedding(text);
    
    return {
      data: embedding,
      dims: [1, 1, DIMENSIONS],
      type: 'Tensor',
    };
  };
}

// Мок для env
const mockEnv = {
  cacheDir: '',
  allowLocalModels: false,
  useBrowserCache: false,
};

module.exports = {
  pipeline: mockPipeline,
  env: mockEnv,
};
