# Devil — Guidelines and Development Patterns

Описание паттернов разработки, соглашений и стандартов кода для расширения Devil.

## Code Quality Standards

### TypeScript Conventions
- **Strict mode** — использование `strict: true` в tsconfig.json
- **Explicit types** — все публичные методы и свойства должны иметь явный тип
- **No implicit any** — запрещено использование `any` без явного указания
- **Interface-first** — использование интерфейсов для описания контрактов (ILLMProvider, IMemoryStore)
- **Const assertions** — использование `as const` для литералов

### Code Formatting
- **Quotes** — одинарные кавычки для строк (`'example'` вместо `"example"`)
- **Semicolons** — отсутствие точки с запятой в конце операторов (по стандарту Prettier)
- **Indentation** — 2 пробела для отступов
- **Line endings** — LF для Unix-совместимости
- **Maximum line length** — 120 символов (приоритет читаемости)

### Naming Conventions
- **Classes** — PascalCase (MemoryStore, CommandHandler, LLMProvider)
- **Interfaces** — I + PascalCase (IMemoryStore, ILLMProvider)
- **Methods** — camelCase (handleMessage, generate, addNode)
- **Constants** — UPPER_SNAKE_CASE (DEFAULT_CONFIG, MAX_RETRIES)
- **Variables** — camelCase (currentModel, projectPath, messageId)

### Documentation Standards
- **JSDoc comments** — обязательные комментарии для всех публичных классов и методов
- **TypeScript types** — описание всех параметров и возвращаемых значений
- **Example code** — примеры использования в JSDoc (see ILLMProvider.ts)
- **Language** — русский язык для комментариев и сообщений

## Architectural Patterns

### Service Layer Pattern
Каждый сервис инкапсулирует определённую функциональность:

```typescript
export class LLMProvider implements ILLMProvider {
  constructor(private readonly configManager: ConfigManager) {
    // Dependency Injection через конструктор
  }
}
```

**Применяется в:**
- LLMProvider — взаимодействие с API
- MemoryStore — работа с базой данных
- ConfigManager — управление настройками
- ProjectManager — управление проектом
- FileSystemService — работа с файлами
- GitService — интеграция с Git

### Command Pattern
Команды выражаются через обработчики с единым интерфейсом:

```typescript
export interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

export class CommandHandler {
  async handleMessage(message: string): Promise<CommandResult | null> {
    // Парсинг команды и маршрутизация
    switch (command) {
      case '/scan': return await this.handleScan(args);
      case '/explain': return await this.handleExplain(args, selectedCode);
      // ...
    }
  }
}
```

### Observer Pattern
Использование подписчиков для реакции на изменения:

```typescript
export class ConfigManager {
  private changeListeners: Array<() => void> = [];
  
  onConfigChanged(listener: () => void): vscode.Disposable {
    this.changeListeners.push(listener);
    return new vscode.Disposable(() => {
      this.changeListeners = this.changeListeners.filter((l) => l !== listener);
    });
  }
  
  private notifyListeners(): void {
    for (const listener of this.changeListeners) {
      try { listener(); } catch (error) { /* handle error */ }
    }
  }
}
```

### Factory Pattern
Создание экземпляров через статические методы:

```typescript
export class ChatPanel {
  public static createOrShow(...args): ChatPanel {
    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel._panel.reveal(column);
      return ChatPanel.currentPanel;
    }
    return new ChatPanel(...args);
  }
}
```

## Internal API Usage Patterns

### Dependency Injection
Сервисы передаются через конструкторы:

```typescript
export class CommandHandler {
  constructor(
    private readonly fileSystemService: FileSystemService,
    private readonly llmProvider: LLMProvider,
    private readonly contextBuilder: ContextBuilder,
    private readonly projectManager: ProjectManager,
    private readonly memoryStore: IMemoryStore,
    private readonly gitService: GitService,
    private readonly searchIndex: SearchIndex
  ) {}
}
```

### Error Handling
Использование кастомных ошибок с разделением на retryable/non-retryable:

```typescript
export class LLMError extends Error {
  constructor(
    public message: string,
    public retryable: boolean,
    public userMessage: string
  ) {
    super(message);
  }
}

export class NetworkError extends Error {
  constructor(
    public message: string,
    public status: number | undefined,
    public userMessage: string
  ) {
    super(message);
  }
}
```

### Async/Await Patterns
Управление ошибками с повторными попытками:

```typescript
async generate(prompt: string, options: GenerateOptions = {}): Promise<LLMResponse> {
  const maxRetries = options.maxRetries || this.configManager.getMaxRetries();
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await this.sendRequest(prompt, options, timeout);
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (error instanceof LLMError && !error.retryable) {
        throw error;
      }
      
      if (attempt < maxRetries) {
        const delay = this.calculateRetryDelay(attempt);
        await this.sleep(delay);
      }
    }
  }
  throw new LLMError('Failed after ' + maxRetries + ' attempts', false, '...');
}
```

### State Management (Webview)
Сохранение состояния через VS Code API:

```typescript
// Сохранение
const currentState = vscode.getState() || { messages: [] };
currentState.messages.push({ role: role, content: content });
vscode.setState(currentState);

// Восстановление
const savedState = vscode.getState();
if (savedState && savedState.messages) {
  savedState.messages.forEach(msg => addMessage(msg.role, msg.content, false));
}
```

### Logging
Единый логгер со структурированными сообщениями:

```typescript
logger.info('CommandHandler инициализирован', 'CommandHandler');
logger.debug('Узел добавлен: ' + node.type + ':' + node.name + ' (id=' + id + ')', 'MemoryStore');
logger.error('Ошибка при обработке сообщения', error, 'ChatPanel');
```

## Common Implementation Patterns

### 1. Pattern: Initialize-Then-Use
Все сервисы инициализируются перед использованием:

```typescript
async initialize(projectPath: string): Promise<void> {
  this.projectPath = projectPath;
  // Создание дир��кторий, инициализация БД
  this.createTables();
  this.applyMigrations();
  this.save();
}
```

### 2. Pattern: Path Handling
Все пути нормализуются относительно projectPath:

```typescript
const relativePath = path.relative(projectPath, filePath);
const fullPath = project.path + '/' + filePath;
```

### 3. Pattern: JSON Metadata Storage
Метаданные хранятся как JSON-строки в базе данных:

```typescript
const metadata = JSON.stringify(node.metadata || {});
this.db.run('INSERT INTO nodes (metadata) VALUES (?)', [metadata]);
```

### 4. Pattern: Markdown Response Format
Ответы LLM всегда возвращаются в формате Markdown:

```typescript
return {
  success: true,
  message: '## Результаты поиска: "' + query + '"\n\n' + formattedContent,
  data: { query, results }
};
```

### 5. Pattern: Command-Specific Result Objects
Каждая команда возвращает структурированный результат:

```typescript
export interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown; // Дополнительные данные для отладки
}
```

### 6. Pattern: Search Result Grouping
Результаты поиска группируются по файлам:

```typescript
const byFile: Record<string, typeof results> = {};
for (const result of results) {
  if (!byFile[result.filePath]) {
    byFile[result.filePath] = [];
  }
  byFile[result.filePath].push(result);
}
```

### 7. Pattern: Table Display for Lists
Списки отображаются в виде Markdown-таблиц:

```typescript
lines.push('| Имя | Путь |');
lines.push('|-----|------|');
for (const node of typeNodes.slice(0, 20)) {
  lines.push('| `' + node.name + '` | `' + node.path + '` |');
}
```

### 8. Pattern: Loading Indicators
Webview показывает индикатор загрузки:

```javascript
function addLoadingIndicator() {
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'message assistant-message loading';
  loadingDiv.innerHTML = '...Думаю...';
  messagesArea.appendChild(loadingDiv);
}
```

## Popular Annotations

### JSDoc Tags
```typescript
/**
 * @param projectPath — путь к проекту
 * @returns ID созданного узла
 * @throws Error если MemoryStore не инициализирован
 */
async addNode(...): Promise<string> { ... }

/**
 * LLMProvider — HTTP-клиент для работы с OpenAI-совместимым API.
 * 
 * @example
 * ```typescript
 * const llmProvider = new LLMProvider(configManager);
 * const response = await llmProvider.generate('Промпт', { temperature: 0.7 });
 * ```
 */
export class LLMProvider { ... }
```

### Type Assertions
```typescript
// Утверждение типа для JSON
const metadata = this.parseJson<Record<string, unknown>>(getValue('metadata') as string);

// Утверждение типа для массивов
const nodes = result[0].values.map((row) => this.rowToNode(result[0].columns, row));
```

## Testing Standards

### Unit Tests
- **Framework** — Jest
- **Location** — `tests/unit/`
- **Naming** — `[ServiceName].test.ts`
- **Structure** — describe > it > expect

### Mocking
- **Mock location** — `tests/__mocks__/vscode.ts`
- **Pattern** — замена методов VS Code API на моки

### Coverage
- **Target** — минимум 80% покрытие
- **Run** — `npm test`

## Performance Best Practices

### 1. Database Optimization
- Индексы для часто используемых полей (type, name, path)
- Пакетные операции для массового добавления узлов
- Кэширование результатов запросов

### 2. Memory Management
- Закрытие соединения с БД при деактивации (`close()`)
- Очистка disposables при остановке (`dispose()`)

### 3. Webview Optimization
- Сжатие HTML-кода (без лишних пробелов)
- Использование nonce для CSP
- Отключение скриптов по условию (проверка `typeof marked !== 'undefined'`)

### 4. LLM API Optimization
- Retry-логика с exponential backoff
- Кэширование промптов (sha256 + expires_at)
- Streaming для больших ответов

## VS Code Extension Patterns

### Activation
```typescript
export function activate(context: vscode.ExtensionContext) {
  // Регистрация команд
  context.subscriptions.push(
    vscode.commands.registerCommand('devil.hello', () => { ... })
  );
  
  // Создание панели
  ChatPanel.createOrShow(extensionUri, ...services);
}
```

### Configuration
```json
{
  "contributes": {
    "configuration": {
      "title": "Devil",
      "properties": {
        "devil.baseUrl": { "type": "string", "default": "https://api.openai.com/v1" },
        "devil.apiKey": { "type": "string", "default": "" },
        "devil.model": { "type": "string", "default": "gpt-4o-mini" }
      }
    }
  }
}
```

### Webview CSP
```typescript
const csp = [
  "default-src 'none'",
  'style-src ' + webview.cspSource,
  "script-src 'nonce-" + nonce + "'",
  'font-src ' + webview.cspSource,
  'img-src ' + webview.cspSource + ' https:',
  'connect-src https:',
].join('; ');
```

## Common Idioms

### 1. Pattern: Null/Undefined Checks
```typescript
const value = getValue('metadata') as string;
const metadata = this.parseJson<Record<string, unknown>>(value);
```

### 2. Pattern: Date.now() for Timestamps
```typescript
const now = Date.now();
this.db.run('INSERT ... updated_at = ?', [now]);
```

### 3. Pattern: crypto.randomUUID() for IDs
```typescript
private generateId(): string {
  return crypto.randomUUID();
}
```

### 4. Pattern: path.extname for Extensions
```typescript
const ext = filePath.split('.').pop()?.toLowerCase();
const langMap: Record<string, string> = { ts: 'typescript', js: 'javascript', ... };
return langMap[ext || ''] || 'text';
```

### 5. Pattern: Array.slice for Pagination
```typescript
for (const node of typeNodes.slice(0, 20)) { ... }
if (typeNodes.length > 20) { ... }
```

### 6. Pattern: Template Literals for Messages
```typescript
const message = `Файл не найден: ${filePath}`;
const formatted = `## Результаты поиска: "${query}"`;
```

## Critical Rules

### ✅ DO:
- Использовать интерфейсы для описания контрактов
- Обрабатывать ошибки в каждом async-методе
- Логировать все важные операции
- Возвращать структурированные результаты из команд
- Использовать TypeScript strict mode

### ❌ DON'T:
- Использовать `any` без необходимости
- Хардкодить пути (использовать projectPath + path.join)
- Блокировать UI в main thread (использовать async/await)
- Игнорировать onConfigChanged в сервисах
- Возвращать null без проверки в calling code

## Language and Localization

### Russian Language
- Все сообщения пользователю — на русском языке
- Комментарии и JSDoc — на русском
- Названия полей и переменных — на английском
- Типы и интерфейсы — на английском

### Markdown Format
- Заголовки: `##`, `###`
- Код: ```language
- Выделение: **bold**, *italic*
- Списки: `-`, `1.`
- Таблицы: `| column |`

## Example: Complete Service Implementation

```typescript
export class ExampleService implements IExampleService {
  constructor(private readonly config: ConfigManager) {}
  
  async initialize(projectPath: string): Promise<void> {
    this.projectPath = projectPath;
    this.validateConfig();
    this.setupListeners();
  }
  
  async process(data: string): Promise<ProcessResult> {
    try {
      const context = await this.buildContext(data);
      const result = await this.api.call(context);
      await this.cache.save(data, result);
      return result;
    } catch (error) {
      logger.error('Ошибка обработки', error, 'ExampleService');
      throw new ServiceError('Processing failed', error);
    }
  }
  
  private validateConfig(): void {
    if (!this.config.isValid()) {
      throw new ConfigError('Invalid configuration', 'Check settings');
    }
  }
  
  private setupListeners(): void {
    this.config.onConfigChanged(() => {
      logger.info('Config changed', 'ExampleService');
      this.reconnect();
    });
  }
}
```

---

**Last Updated:** 2026  
**Version:** 0.1.0  
**Maintainer:** Devil Team