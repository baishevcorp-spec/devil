# Ответы на ваши вопросы

## 1. Про автоматическое обновление .vsix

**Нет, не обновится автоматически.**

**Причина:** VS Code различает два типа установки расширений:

- **Из Marketplace** — обновления приходят автоматически (если включено)
- **Из .vsix файла** (локальная установка) — **не обновляется автоматически**

Каждый раз после изменений в коде нужно:

1. Переупаковать расширение: `npx vsce package --allow-missing-repository`
2. Удалить старую версию в VS Code (Extensions → Devil → Uninstall)
3. Установить новую: `Extensions → ... (три точки) → Install from VSIX...`

**Совет:** Чтобы не переустанавливать каждый раз при разработке, используйте **режим разработки**:

- Откройте папку проекта `devil` в VS Code
- Нажмите `F5` — запустится **Extension Development Host** (отдельное окно VS Code с вашим расширением)
- Изменения применяются сразу после `Ctrl+Shift+P` → `Developer: Reload Window`
- Это намного быстрее, чем переупаковка .vsix

## 2. Настройка devil.baseUrl и devil.apiKey

Есть **два способа** — через UI и через файл напрямую.

### Способ 1: Через UI настроек (рекомендуется)

1. Откройте VS Code
2. `Ctrl + ,` (или `File → Preferences → Settings`)
3. В поиске введите: `devil`
4. Вы увидите все настройки расширения:
   - **Devil: Base Url** — введите URL API
   - **Devil: Api Key** — введите ваш API-ключ
   - **Devil: Model** — выберите модель
   - и т.д.

### Способ 2: Через settings.json напрямую

1. Откройте палитру команд: `Ctrl + Shift + P`
2. Введите: `Preferences: Open User Settings (JSON)`
3. Добавьте блок `devil`:

```json
{
  "devil.baseUrl": "https://api.openai.com/v1",
  "devil.apiKey": "sk-proj-ваш-ключ-сюда",
  "devil.model": "gpt-4o-mini",
  "devil.maxRetries": 3,
  "devil.cacheTtlSeconds": 604800,
  "devil.defaultSystemPrompt": "Ты — Devil, интеллектуальный ассистент для разработчика. Отвечай на русском языке, кратко и по делу. Используй Markdown для форматирования.",
  "devil.debugMode": false
}
```

### Примеры для разных провайдеров

**OpenAI (официальный API):**

```json
{
  "devil.baseUrl": "https://api.openai.com/v1",
  "devil.apiKey": "sk-proj-...",
  "devil.model": "gpt-4o-mini"
}
```

**Прокси-сервис (например, myproxyapi.ru):**

```json
{
  "devil.baseUrl": "https://api.myproxyapi.ru/v1",
  "devil.apiKey": "ваш-ключ-от-прокси",
  "devil.model": "gpt-4o-mini"
}
```

**Ollama (локальная модель):**

```json
{
  "devil.baseUrl": "http://localhost:11434/v1",
  "devil.apiKey": "ollama",
  "devil.model": "llama3"
}
```

**DeepSeek:**

```json
{
  "devil.baseUrl": "https://api.deepseek.com/v1",
  "devil.apiKey": "sk-...",
  "devil.model": "deepseek-chat"
}
```

### Где хранится settings.json

- **User settings** (глобальные, для всех проектов):
  - Windows: `%APPDATA%\Code\User\settings.json`
  - macOS: `~/Library/Application Support/Code/User/settings.json`
  - Linux: `~/.config/Code/User/settings.json`

- **Workspace settings** (только для текущего проекта):
  - Создайте файл `.vscode/settings.json` в корне проекта
  - Эти настройки имеют приоритет над User settings

## 3. Как проверить, что всё работает

После настройки выполните команду:

1. `Ctrl + Shift + P` → введите `Devil: Test LLM`
2. Должно появиться сообщение: `Devil: Тестирование LLM...`
3. Через несколько секунд: `Devil LLM ответ: Привет, мир!...` (или похожее)

**Если возникла ошибка:**

- Откройте Output Channel: `View → Output` → в выпадающем списке выберите `Devil`
- Там будут подробные логи с описанием проблемы
- Типичные ошибки:
  - `401 Unauthorized` — неверный API-ключ
  - `404 Not Found` — неверный baseUrl или модель
  - `429 Too Many Requests` — превышен лимит запросов
  - `ECONNREFUSED` — Ollama не запущена или неверный порт

---

Форматы команды /diff:
/diff — показывает последние изменения (HEAD~1..HEAD)

/diff abc123 — показывает изменения в конкретном коммите

/diff abc123 def456 — показывает diff между двумя коммитами
