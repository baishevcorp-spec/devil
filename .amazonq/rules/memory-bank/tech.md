# Devil — Технологический стек

Описание используемых технологий и инструментов.

## Основные технологии

- **TypeScript** — основной язык программирования (версия 5+)
- **Node.js** — среда выполнения (версия 18+)
- **VS Code Extension API** — API для разработки расширений (версия 1.78+)

## Зависимости

### runtimeDependencies
- **@types/node** — типы для Node.js
- **@types/vscode** — типы для VS Code Extension API
- **@vscode/webview-ui-toolkit** — UI-компоненты для веб-интерфейса

### devDependencies
- **@types/jest** — типы для Jest
- **@typescript-eslint/eslint-plugin** — линтер TypeScript
- **@typescript-eslint/parser** — парсер TypeScript для ESLint
- **eslint** — линтер JavaScript/TypeScript
- **jest** — фреймворк для тестирования
- **ts-jest** — транспилер TypeScript для Jest
- **ts-node** — выполнение TypeScript-кода
- **typescript** — компилятор TypeScript

## Сборка и запуск

### Команды npm

- **npm install** — установка зависимостей
- **npm run compile** — компиляция TypeScript в JavaScript (out/extension.js)
- **npm run watch** — компиляция с отслеживанием изменений
- **npm run lint** — проверка стиля кода с ESLint
- **npm test** — запуск тестов с Jest

### Конфигурационные файлы

- **package.json** — описание пакета, скрипты, зависимости
- **tsconfig.json** — настройки TypeScript (target: ES2022, module: commonjs)
- **.eslintrc.json** — правила ESLint
- **.prettierrc** — настройки Prettier (одинарные кавычки, пробелы, безточек с запятой)
- **jest.config.js** — настройки Jest (testEnvironment: node, transform: ts-jest)

### Структура сборки

- Исходный код: `src/`
- Скомпилированный код: `out/`
- Тесты: `tests/`
- Веб-интерфейс: `webview/`

## API интеграции

### OpenAI-совместимые API

Используется стандартный формат запроса/ответа для OpenAI API:

- **URL**: настраиваемый (по умолчанию: `https://api.openai.com/v1`)
- **Модель**: настраиваемая (по умолчанию: `gpt-4o-mini`)
- **Authentication**: Bearer token в заголовке Authorization

### Формат запроса

```json
{
  "model": "gpt-4o-mini",
  "messages": [
    {"role": "system", "content": "..."},
    {"role": "user", "content": "..."}
  ],
  "temperature": 0.7
}
```

### Формат ответа

```json
{
  "id": "chatcmpl-xxx",
  "choices": [
    {
      "index": 0,
      "message": {"role": "assistant", "content": "..."},
      "finish_reason": "stop"
    }
  ],
  "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150}
}
```

## Развёртывание

### Установка

1. Скачать `.vsix` файл из релизов
2. В VS Code: `Extensions` → `...` → `Install from VSIX...`
3. Выбрать скачанный файл

### Сборка и установка локально

```bash
npm install
npm run compile
vsce package
```

Затем установить `.vsix` файл через VS Code.

## Лицензия

MIT