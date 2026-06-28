/**
 * Генератор тестового проекта для нагрузочного тестирования.
 * Создаёт N файлов с реалистичным содержимым.
 * 
 * Использование: node tests/performance/generate-test-project.js [количество файлов] [путь]
 */

const fs = require('fs');
const path = require('path');

const fileCount = parseInt(process.argv[2]) || 1500;
const outputDir = process.argv[3] || path.join(__dirname, 'test-project-1500');

const directories = [
  'src/components',
  'src/services',
  'src/utils',
  'src/hooks',
  'src/pages',
  'src/store',
  'src/types',
  'src/api',
  'src/middleware',
  'src/config',
  'tests/unit',
  'tests/integration',
  'tests/e2e',
  'scripts',
  'docs'
];

const templates = [
  // React компонент
  `import React, { useState, useEffect } from 'react';

interface Props {
  title: string;
  items: string[];
  onSelect: (item: string) => void;
}

export const Component{{ID}}: React.FC<Props> = ({ title, items, onSelect }) => {
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => setLoading(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  const handleClick = (item: string) => {
    setSelected(item);
    onSelect(item);
  };

  return (
    <div className="component-{{ID}}">
      <h2>{title}</h2>
      {loading ? <p>Loading...</p> : (
        <ul>
          {items.map((item, index) => (
            <li key={index} onClick={() => handleClick(item)}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
};`,

  // Сервис
  `import axios from 'axios';

const BASE_URL = process.env.API_URL || 'http://localhost:3000';

export class Service{{ID}} {
  private baseUrl: string;

  constructor(baseUrl: string = BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async fetchData<T>(endpoint: string): Promise<T> {
    const response = await axios.get<T>(\`\${this.baseUrl}/\${endpoint}\`);
    return response.data;
  }

  async postData<T>(endpoint: string, data: unknown): Promise<T> {
    const response = await axios.post<T>(\`\${this.baseUrl}/\${endpoint}\`, data);
    return response.data;
  }

  async deleteData(endpoint: string): Promise<void> {
    await axios.delete(\`\${this.baseUrl}/\${endpoint}\`);
  }
}`,

  // Утилита
  `export function formatDate{{ID}}(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function debounce{{ID}}<T extends (...args: unknown[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function deepClone{{ID}}<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}`,

  // Хук
  `import { useState, useCallback } from 'react';

export function useToggle{{ID}}(initialValue: boolean = false) {
  const [value, setValue] = useState(initialValue);
  const toggle = useCallback(() => setValue(v => !v), []);
  const setTrue = useCallback(() => setValue(true), []);
  const setFalse = useCallback(() => setValue(false), []);
  return { value, toggle, setTrue, setFalse };
}`,

  // Тест
  `import { Service{{ID}} } from '../../src/services/Service{{ID}}';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Service{{ID}}', () => {
  let service: Service{{ID}};

  beforeEach(() => {
    service = new Service{{ID}}();
  });

  it('should fetch data', async () => {
    mockedAxios.get.mockResolvedValue({ data: { id: 1 } });
    const result = await service.fetchData('test');
    expect(result).toEqual({ id: 1 });
  });
});`
];

console.log('Генерация тестового проекта: ' + fileCount + ' файлов в ' + outputDir);

// Создаём директории
for (const dir of directories) {
  fs.mkdirSync(path.join(outputDir, dir), { recursive: true });
}

// Создаём package.json
fs.writeFileSync(
  path.join(outputDir, 'package.json'),
  JSON.stringify({
    name: 'test-project-1500',
    version: '1.0.0',
    dependencies: { react: '^18.0.0', axios: '^1.0.0' },
    devDependencies: { typescript: '^5.0.0', jest: '^29.0.0' }
  }, null, 2)
);

// Создаём tsconfig.json
fs.writeFileSync(
  path.join(outputDir, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: { target: 'ES2020', module: 'commonjs', outDir: './dist', strict: true },
    include: ['src/**/*']
  }, null, 2)
);

// Генерируем файлы
let created = 0;
for (let i = 0; i < fileCount; i++) {
  const dir = directories[i % directories.length];
  const template = templates[i % templates.length];
  const ext = template.includes('React') || template.includes('useState') ? '.tsx' : '.ts';
  const fileName = 'file_' + i + ext;
  const filePath = path.join(outputDir, dir, fileName);
  const content = template.replace(/\{\{ID\}\}/g, String(i));
  
  fs.writeFileSync(filePath, content, 'utf-8');
  created++;
  
  if (created % 100 === 0) {
    console.log('  Создано файлов: ' + created + '/' + fileCount);
  }
}

console.log('✓ Тестовый проект создан: ' + created + ' файлов в ' + outputDir);
