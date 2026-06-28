import { SearchIndex } from '../../src/services/SearchIndex';
import { FileSystemService } from '../../src/services/FileSystemService';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('SearchIndex Performance Tests (DEVOPS-09)', () => {
  let searchIndex: SearchIndex;
  let fsService: FileSystemService;
  let testDir: string;

  beforeAll(async () => {
    testDir = path.join(os.tmpdir(), 'devil-perf-test-' + Date.now());
    fsService = new FileSystemService();
    searchIndex = new SearchIndex(fsService);
    await searchIndex.initialize(testDir);

    // Генерируем тестовые файлы
    const fileCount = 100; // Используем 100 файлов для юнит-теста (1500 — для ручного)
    const dirs = ['src/components', 'src/services', 'src/utils', 'src/hooks'];
    
    for (const dir of dirs) {
      await fs.mkdir(path.join(testDir, dir), { recursive: true });
    }

    for (let i = 0; i < fileCount; i++) {
      const dir = dirs[i % dirs.length];
      const content = `
import React, { useState, useEffect } from 'react';

export function Component${i}() {
  const [data, setData] = useState(null);
  
  useEffect(() => {
    fetchData().then(setData);
  }, []);

  return <div>Component ${i}</div>;
}

export function fetchData${i}() {
  return fetch('/api/data/${i}').then(r => r.json());
}

export function useEffect${i}(callback: () => void) {
  callback();
}
`;
      await fs.writeFile(path.join(testDir, dir, `file_${i}.tsx`), content, 'utf-8');
    }
  }, 30000);

  afterAll(async () => {
    await searchIndex.clear();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('Индексация', () => {
    it('строит индекс за <5 секунд (100 файлов)', async () => {
      const startTime = Date.now();
      await searchIndex.buildIndex();
      const duration = Date.now() - startTime;

      console.log(`⏱️  Индексация 100 файлов: ${duration}мс`);
      expect(duration).toBeLessThan(5000);

      const stats = await searchIndex.getStats();
      expect(stats.totalFiles).toBe(100);
    });
  });

  describe('Поиск', () => {
    beforeAll(async () => {
      await searchIndex.buildIndex();
    });

    it('находит useEffect за <200мс', async () => {
      const startTime = Date.now();
      const results = await searchIndex.search('useEffect');
      const duration = Date.now() - startTime;

      console.log(`⏱️  Поиск "useEffect": ${duration}мс (${results.length} результатов)`);
      expect(duration).toBeLessThan(200);
      expect(results.length).toBeGreaterThan(0);
    });

    it('находит fetchData за <200мс', async () => {
      const startTime = Date.now();
      const results = await searchIndex.search('fetchData');
      const duration = Date.now() - startTime;

      console.log(`⏱️  Поиск "fetchData": ${duration}мс (${results.length} результатов)`);
      expect(duration).toBeLessThan(200);
      expect(results.length).toBeGreaterThan(0);
    });

    it('находит Component за <200мс', async () => {
      const startTime = Date.now();
      const results = await searchIndex.search('Component');
      const duration = Date.now() - startTime;

      console.log(`⏱️  Поиск "Component": ${duration}мс (${results.length} результатов)`);
      expect(duration).toBeLessThan(200);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Инкрементальное обновление', () => {
    it('обновляет индекс при изменении файла за <2 секунд', async () => {
      const testFile = path.join(testDir, 'src/components/file_0.tsx');
      await fs.writeFile(testFile, 'export const updated = true; useEffect();', 'utf-8');

      const startTime = Date.now();
      await searchIndex.updateInIndex(testFile);
      const duration = Date.now() - startTime;

      console.log(`⏱️  Инкрементальное обновление: ${duration}мс`);
      expect(duration).toBeLessThan(2000);

      const results = await searchIndex.search('updated');
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
