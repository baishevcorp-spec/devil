# Фаза 0: Discovery и инициация (Sprint 0).

## Checkpoint 25.06.2026 21:52

**Sprint 0 — статус:**

| Задача | Статус |
|--------|--------|
| DEVOPS-01: Репозиторий, eslint, prettier, tsconfig | ✅ Готово |
| DEVOPS-02: npm run compile, watch, lint | ✅ Готово |
| DEVOPS-03: vsce для упаковки | ✅ Готово |
| DEVOPS-04: Jest | ✅ Готово |
| ARCH-01: Диаграмма архитектуры | ✅ Готово |
| ARCH-02: Схема SQLite | ✅ Готово |
| ARCH-03: Контракты LLM | ✅ Готово |
| UI-DESIGN-01: Макет чата | ✅ Готово |

**Все задачи Sprint 0 выполнены!** 🎉

---

# Sprint 1: Фундамент: Ядро расширения и чат

## Checkpoint 25.06.2026 21:52

### Статус Sprint 1

| Задача | Статус | Описание |
|--------|--------|----------|
| BCK-01 | ✅ | extension.ts (точка входа) |
| BCK-02 | ✅ | ProjectManager |
| BCK-03 | ✅ | FileSystemService |
| BCK-04 | ✅ | LLMProvider с retry logic |
| BCK-05 | ✅ | ConfigManager |
| BCK-06 | ✅ | 45 юнит-тестов |
| BCK-07 | ✅ | ContextBuilder |

## Что реализовано

**Backend-сервисы:**
- `ConfigManager` — управление настройками расширения
- `FileSystemService` — работа с файловой системой
- `ProjectManager` — управление проектом и отслеживание изменений
- `LLMProvider` — HTTP-клиент для OpenAI-совместимого API с retry logic
- `ContextBuilder` — построение системного промпта с контекстом проекта

**Инфраструктура:**
- Централизованное логирование через Output Channel
- Система кастомных ошибок (DevilError, ConfigError, NetworkError, LLMError, ProjectError)
- Мок-модуль `vscode` для тестирования
- 45 юнит-тестов с покрытием всех сервисов

**Тестовые команды:**
- `devil.hello` — проверка активации расширения
- `devil.openProject` — открытие проекта через диалог
- `devil.testLLM` — тестирование работы с LLM (использует ContextBuilder)

## Следующий шаг: UI-01 — Webview-панель чата

Теперь нужно реализовать **фронтенд** — чат-интерфейс, который пользователь увидит в VS Code.

**Задачи UI-01..UI-04:**
1. **UI-01**: Создание Webview-панели (открытие чата по команде `devil.openChat`)
2. **UI-02**: Обмен сообщениями между Webview и Extension (postMessage API)
3. **UI-03**: Рендеринг Markdown в сообщениях (marked + highlight.js)
4. **UI-04**: Кнопки копирования кода

**Что будет реализовано:**
- Интеграция статического макета `webview/chat.html` в VS Code Webview API
- Создание `ChatPanel` класса для управления панелью
- Обработка сообщений от пользователя и отправка в LLM
- Отображение ответов агента с форматированием
