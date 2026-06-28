import { SearchIndex } from '../../src/services/SearchIndex';
import { FileSystemService } from '../../src/services/FileSystemService';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * DEVOPS-09: Нагрузочное тестирование SearchIndex на 1500 файлах.
 * 
 * Чекпоинты:
 * - Построение индекса <5 сек
 * - Поиск <200 мс
 * - Инкрементальное обновление <2 сек
 * 
 * Использование:
 *   LOAD_TEST_PROJECT_PATH=C:/myproject/test_project npm test -- tests/performance/LoadTest.1500.test.ts
 * 
 * Если переменная не задана, используется C:/myproject/test_project по умолчанию.
 */

const PROJECT_PATH = process.env.LOAD_TEST_PROJECT_PATH || 'C:/myproject/test_project';

describe('DEVOPS-09: Load Test (1500 files)', () => {
  let searchIndex: SearchIndex;
  let fsService: FileSystemService;
  let fileCount: number;

  beforeAll(async () => {
    fsService = new FileSystemService();
    searchIndex = new SearchIndex(fsService);

    // Проверяем, что проект существует
    const exists = await fsService.fileExists(path.join(PROJECT_PATH, 'package.json'));
    if (!exists) {
      throw new Error(
        `Тестовый проект не найден по пути: ${PROJECT_PATH}\n` +
        `Создайте проект: node tests/performance/generate-test-project.js 1500 ${PROJECT_PATH}`
      );
    }

    // Считаем файлы в проекте
    const tree = await fsService.scanDirectory(PROJECT_PATH);
    fileCount = countFiles(tree);

    console.log('\n' + '='.repeat(70));
    console.log('DEVOPS-09: НАГРУЗОЧНОЕ ТЕСТИРОВАНИЕ');
    console.log('='.repeat(70));
    console.log(`Проект: ${PROJECT_PATH}`);
    console.log(`Файлов в проекте: ${fileCount}`);
    console.log('='.repeat(70) + '\n');

    await searchIndex.initialize(PROJECT_PATH);
  }, 60000);

  afterAll(async () => {
    await searchIndex.clear();
    console.log('\n' + '='.repeat(70));
    console.log('Тестирование завершено');
    console.log('='.repeat(70) + '\n');
  }, 10000);

  describe('BCK-27: Построение индекса', () => {
    it('строит индекс на 1500 файлах за <5 секунд', async () => {
      const startTime = Date.now();
      await searchIndex.buildIndex();
      const buildDuration = Date.now() - startTime;

      const stats = await searchIndex.getStats();

      console.log('\n📊 РЕЗУЛЬТАТЫ ПОСТРОЕНИЯ ИНДЕКСА:');
      console.log('─'.repeat(50));
      console.log(`  Файлов проиндексировано: ${stats.totalFiles}`);
      console.log(`  Документов (строк):      ${stats.totalDocuments}`);
      console.log(`  Время построения:        ${buildDuration} мс`);
      console.log(`  Скорость:                ${(stats.totalFiles / (buildDuration / 1000)).toFixed(0)} файлов/сек`);
      console.log(`  Лимит (чекпоинт):        5000 мс`);
      console.log(`  Статус:                  ${buildDuration < 5000 ? '✅ ПРОЙДЕН' : '❌ ПРОВАЛЕН'}`);
      console.log('─'.repeat(50) + '\n');

      expect(stats.totalFiles).toBeGreaterThan(1000);
      expect(buildDuration).toBeLessThan(5000);
    }, 30000);
  });

  describe('BCK-28: Поиск', () => {
    const searchQueries = [
      { query: 'useEffect', description: 'React-хук (частый запрос)' },
      { query: 'fetchData', description: 'Имя функции' },
      { query: 'Component', description: 'Общее слово (много совпадений)' },
      { query: 'Service', description: 'Класс сервиса' },
      { query: 'debounce', description: 'Утилита' },
      { query: 'useState', description: 'Ещё один React-хук' },
      { query: 'axios', description: 'Библиотека' },
      { query: 'mockResolvedValue', description: 'Тестовый код' },
    ];

    beforeAll(async () => {
      // Убеждаемся, что индекс построен
      const stats = await searchIndex.getStats();
      if (stats.totalFiles === 0) {
        await searchIndex.buildIndex();
      }
    });

    it.each(searchQueries)(
      'поиск "$description" ($query) за <200 мс',
      async ({ query }) => {
        const startTime = Date.now();
        const results = await searchIndex.search(query, { limit: 50 });
        const duration = Date.now() - startTime;

        console.log(`  🔍 "${query}": ${duration} мс, найдено ${results.length} результатов`);

        expect(duration).toBeLessThan(200);
      },
      5000
    );

    it('среднее время поиска по всем запросам <200 мс', async () => {
      const durations: number[] = [];

      for (const { query } of searchQueries) {
        const startTime = Date.now();
        await searchIndex.search(query, { limit: 50 });
        durations.push(Date.now() - startTime);
      }

      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
      const maxDuration = Math.max(...durations);

      console.log('\n📊 СВОДКА ПО ПОИСКУ:');
      console.log('─'.repeat(50));
      console.log(`  Запросов выполнено:  ${durations.length}`);
      console.log(`  Среднее время:       ${avgDuration.toFixed(1)} мс`);
      console.log(`  Максимальное время:  ${maxDuration} мс`);
      console.log(`  Минимальное время:   ${Math.min(...durations)} мс`);
      console.log(`  Лимит (чекпоинт):    200 мс`);
      console.log(`  Статус:              ${avgDuration < 200 ? '✅ ПРОЙДЕН' : '❌ ПРОВАЛЕН'}`);
      console.log('─'.repeat(50) + '\n');

      expect(avgDuration).toBeLessThan(200);
    }, 10000);
  });

  describe('BCK-27: Инкрементальное обновление', () => {
    let testFilePath: string;

    beforeAll(async () => {
      // Создаём тестовый файл в проекте
      testFilePath = path.join(PROJECT_PATH, 'src', 'components', 'perf-test-temp.tsx');
      await fs.writeFile(
        testFilePath,
        'export function PerfTestComponent() { return <div>test</div>; }',
        'utf-8'
      );
    });

    afterAll(async () => {
      // Удаляем тестовый файл
      try {
        await fs.unlink(testFilePath);
      } catch {
        // Файл может не существовать
      }
    });

    it('обновляет индекс при изменении файла за <2 секунд', async () => {
      const startTime = Date.now();
      await searchIndex.updateInIndex(testFilePath);
      const duration = Date.now() - startTime;

      console.log('\n📊 ИНКРЕМЕНТАЛЬНОЕ ОБНОВЛЕНИЕ:');
      console.log('─'.repeat(50));
      console.log(`  Время обновления:  ${duration} мс`);
      console.log(`  Лимит (чекпоинт):  2000 мс`);
      console.log(`  Статус:            ${duration < 2000 ? '✅ ПРОЙДЕН' : '❌ ПРОВАЛЕН'}`);
      console.log('─'.repeat(50) + '\n');

      expect(duration).toBeLessThan(2000);

      // Проверяем, что файл действительно обновился
      const results = await searchIndex.search('PerfTestComponent');
      expect(results.length).toBeGreaterThan(0);
    }, 5000);

    it('добавление нового файла в индекс за <2 секунд', async () => {
      const newFilePath = path.join(PROJECT_PATH, 'src', 'utils', 'perf-test-new.ts');
      await fs.writeFile(
        newFilePath,
        'export function brandNewFunction() { return 42; }',
        'utf-8'
      );

      const startTime = Date.now();
      await searchIndex.addToIndex(newFilePath);
      const duration = Date.now() - startTime;

      console.log(`  ➕ Добавление нового файла: ${duration} мс`);

      expect(duration).toBeLessThan(2000);

      const results = await searchIndex.search('brandNewFunction');
      expect(results.length).toBeGreaterThan(0);

      await fs.unlink(newFilePath);
    }, 5000);

    it('удаление файла из индекса за <1 секунды', async () => {
      // Используем уникальное слово с суффиксом, чтобы гарантировать отсутствие в проекте
      const uniqueMarker = 'UNIQUE_MARKER_' + Date.now();
      const tempFilePath = path.join(PROJECT_PATH, 'src', 'utils', 'perf-test-delete.ts');
      await fs.writeFile(tempFilePath, 'export const ' + uniqueMarker + ' = true;', 'utf-8');
      await searchIndex.addToIndex(tempFilePath);

      // Проверяем, что файл добавился
      const beforeDelete = await searchIndex.search(uniqueMarker);
      expect(beforeDelete.length).toBeGreaterThan(0);

      const startTime = Date.now();
      await searchIndex.removeFromIndex(tempFilePath);
      const duration = Date.now() - startTime;

      console.log(`  ➖ Удаление файла из индекса: ${duration} мс`);

      expect(duration).toBeLessThan(1000);

      // Проверяем, что уникальное слово больше не находится
      const afterDelete = await searchIndex.search(uniqueMarker);
      expect(afterDelete.length).toBe(0);

      await fs.unlink(tempFilePath);
    }, 5000);
  });

  describe('BCK-27: Статистика и память', () => {
    it('возвращает корректную статистику', async () => {
      const stats = await searchIndex.getStats();

      console.log('\n📊 СТАТИСТИКА ИНДЕКСА:');
      console.log('─'.repeat(50));
      console.log(`  Файлов:        ${stats.totalFiles}`);
      console.log(`  Документов:    ${stats.totalDocuments}`);
      console.log(`  Размер (оцен.): ${(stats.indexSize / 1024).toFixed(1)} КБ`);
      console.log('─'.repeat(50) + '\n');

      expect(stats.totalFiles).toBeGreaterThan(1000);
      expect(stats.totalDocuments).toBeGreaterThan(5000);
      expect(stats.indexSize).toBeGreaterThan(0);
    });
  });
});

/**
 * Подсчёт файлов в дереве.
 */
function countFiles(node: any): number {
  let count = 0;
  if (node.type === 'file') count++;
  if (node.children) {
    for (const child of node.children) {
      count += countFiles(child);
    }
  }
  return count;
}
