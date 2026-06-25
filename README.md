# Devil — AI Assistant for Developers

Интеллектуальный агент-ассистент для VS Code с долговременной памятью.

## Возможности

- 💬 Чат с LLM через OpenAI-совместимый API
- 📂 Управление проектом и сканирование структуры
- 🧠 Графовая память для хранения контекста проекта
- 🔍 Быстрый поиск по коду
- 🛠 Генерация кода, патчей и тестов

## Установка

1. Скачайте `.vsix` файл из релизов
2. В VS Code: `Extensions` → `...` → `Install from VSIX...`
3. Выберите скачанный файл

## Команды

- `Devil: Hello` — тестовая команда для проверки работы
- `Devil: Open Chat` — открыть чат-панель
- `Devil: Open Project` — выбрать папку проекта

## Настройка

В `settings.json`:

```json
{
  "devil.baseUrl": "https://api.myproxyapi.ru/v1",
  "devil.apiKey": "your-api-key",
  "devil.model": "gpt-4o-mini"
}

Разработка

npm install
npm run compile
npm run watch
npm run lint
npm test

Лицензия

MIT
