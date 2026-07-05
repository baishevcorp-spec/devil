// webview/chat.js (fully fixed)
(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  // ========================================
  // Кэшируем элементы DOM
  // ========================================
  let messageInput = null;
  let sendButton = null;
  let messagesArea = null;

  // ========================================
  // Функции модалки настроек (на уровне IIFE, доступны отовсюду)
  // ========================================
  function openSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (modal) {
      modal.classList.add('active');
      console.log('[Devil] Модалка открыта');
      vscode.postMessage({ type: 'getAvailableModels' });
    }
  }

  function closeSettingsModalHandler() {
    const modal = document.getElementById('settingsModal');
    if (modal) {
      modal.classList.remove('active');
      console.log('[Devil] Модалка закрыта');
    }
  }

  // ========================================
  // Инициализация UI
  // ========================================
  function initUI() {
    console.log('[Devil] Инициализация UI...');

    try {
      messageInput = document.getElementById('messageInput');
      sendButton = document.getElementById('sendButton');
      messagesArea = document.getElementById('messagesArea');

      if (!messageInput || !sendButton || !messagesArea) {
        throw new Error('Один из элементов не найден');
      }
    } catch (err) {
      console.error('[Devil] Ошибка при загрузке DOM-элементов:', err);
      return;
    }

    initMarkdown();
    initButtons();
    loadHistory();
    initSettingsModal();
    initCommandDropdown();

    console.log('[Devil] UI инициализирован успешно.');
  }

  // ========================================
  // Инициализация Markdown
  // ========================================
  function initMarkdown() {
    if (typeof marked === 'undefined') {
      console.warn('[Devil] marked не загружен');
      return;
    }

    const hljsAvailable = typeof hljs !== 'undefined';

    marked.setOptions({
      breaks: true,
      gfm: true,
      headerIds: false,
      mangle: false,
      highlight: function (code, lang) {
        if (hljsAvailable && lang && hljs.getLanguage(lang)) {
          try {
            return hljs.highlight(code, { language: lang }).value;
          } catch (err) {
            console.error('[Devil] Highlight error:', err);
          }
        }
        return code;
      },
    });
  }

  // ========================================
  // Инициализация кнопок
  // ========================================
  function initButtons() {
    if (!messageInput || !sendButton) return;

    // Auto-resize textarea
    messageInput.addEventListener('input', function () {
      messageInput.style.height = 'auto';
      messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
    });

    // Отправка по Enter
    messageInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Отправка по кнопке
    sendButton.addEventListener('click', sendMessage);

    // Кнопка очистки
    const clearButton = document.querySelector('.header-actions button[title="Очистить историю"]');
    if (clearButton) {
      clearButton.addEventListener('click', clearHistory);
    }
  }

  // ========================================
  // Отправка сообщений
  // ========================================
  function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    addMessage('user', text);

    vscode.postMessage({
      type: 'userMessage',
      content: text,
    });

    messageInput.value = '';
    messageInput.style.height = 'auto';

    addLoadingIndicator();
  }

  function clearHistory() {
    const welcomeMessage = {
      role: 'assistant',
      content:
        'Привет! Я Devil — твой интеллектуальный ассистент для разработки. ' +
        'Я могу помочь с генерацией кода, объяснением, рефакторингом и анализом проекта.',
    };

    vscode.setState({ messages: [welcomeMessage] });
    messagesArea.innerHTML = '';
    addMessage('assistant', welcomeMessage.content, false);
  }

  function addMessage(role, content, save) {
    if (save === undefined) save = true;

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ' + role + '-message';

    const avatar = role === 'user' ? '👤' : '🤖';
    const markedAvailable = typeof marked !== 'undefined';

    let renderedContent = content;
    if (role === 'assistant' && markedAvailable) {
      renderedContent = marked.parse(content);
    } else if (role === 'user') {
      renderedContent = escapeHtml(content);
    }

    messageDiv.innerHTML =
      '<div class="message-avatar">' +
      avatar +
      '</div>' +
      '<div class="message-content">' +
      '<div class="message-text">' +
      renderedContent +
      '</div>' +
      '</div>';

    messagesArea.appendChild(messageDiv);
    messagesArea.scrollTop = messagesArea.scrollHeight;

    if (role === 'assistant') {
      addCopyButtons(messageDiv);
    }

    if (save) {
      const currentState = vscode.getState() || { messages: [] };
      currentState.messages.push({ role: role, content: content });
      vscode.setState(currentState);
    }
  }

  function addCopyButtons(messageDiv) {
    const codeBlocks = messageDiv.querySelectorAll('pre code');
    codeBlocks.forEach(function (codeBlock) {
      const pre = codeBlock.parentElement;
      if (pre && !pre.querySelector('.copy-button-wrapper')) {
        const wrapper = document.createElement('div');
        wrapper.className = 'copy-button-wrapper';

        const button = document.createElement('button');
        button.className = 'copy-button';
        button.textContent = '📋 Копировать';
        button.onclick = function () {
          navigator.clipboard.writeText(codeBlock.textContent || '').then(function () {
            button.textContent = '✓ Скопировано';
            setTimeout(function () {
              button.textContent = '📋 Копировать';
            }, 2000);
          });
        };

        wrapper.appendChild(button);
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);
      }
    });
  }

  function addLoadingIndicator() {
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message assistant-message loading';
    loadingDiv.id = 'loading-indicator';
    loadingDiv.innerHTML =
      '<div class="message-avatar">🤖</div>' +
      '<div class="message-content">' +
      '<div class="message-text">Думаю...</div>' +
      '</div>';

    messagesArea.appendChild(loadingDiv);
    messagesArea.scrollTop = messagesArea.scrollHeight;
  }

  function removeLoadingIndicator() {
    const loading = document.getElementById('loading-indicator');
    if (loading) {
      loading.remove();
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ========================================
  // Загрузка истории
  // ========================================
  function loadHistory() {
    const savedState = vscode.getState();
    if (savedState && savedState.messages && Array.isArray(savedState.messages)) {
      savedState.messages.forEach(function (msg) {
        addMessage(msg.role, msg.content, false);
      });
    }
  }

  // ========================================
  // Обработка сообщений от extension
  // ========================================
  window.addEventListener('message', function (event) {
    const message = event.data;

    switch (message.type) {
      case 'agentResponse':
        removeLoadingIndicator();
        addMessage('assistant', message.content || '');
        setTimeout(setupFileLinkHandlers, 100);
        break;

      case 'error':
        removeLoadingIndicator();
        addMessage('assistant', 'Ошибка: ' + (message.text || 'Неизвестная ошибка'));
        break;

      case 'history':
        if (message.messages && Array.isArray(message.messages)) {
          messagesArea.innerHTML = '';
          message.messages.forEach(function (msg) {
            addMessage(msg.role, msg.content, false);
          });
        }
        break;

      case 'executeCommand':
        if (message.content && messageInput) {
          messageInput.value = message.content;
          sendMessage();
        }
        break;

      case 'loadSettings':
        console.log('[Devil] Загружены настройки:', message.settings);
        loadSettingsIntoUI(message.settings);
        break;

      case 'availableModels':
        console.log('[Devil] Загружены модели:', message.models);
        populateModelSelect(message.models, message.currentModel);
        break;
    }
  });

  // ========================================
  // Настройки модального окна
  // ========================================
  function initSettingsModal() {
    console.log('[Devil] Инициализация модалки настроек...');

    const settingsButton = document.querySelector('.header-actions button[title="Настройки"]');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsModal = document.getElementById('closeSettingsModal');
    const cancelSettings = document.getElementById('cancelSettings');
    const saveSettings = document.getElementById('saveSettings');

    console.log('[Devil] settingsButton:', settingsButton);
    console.log('[Devil] settingsModal:', settingsModal);

    // Клик по кнопке настроек
    if (settingsButton) {
      settingsButton.addEventListener('click', function () {
        console.log('[Devil] Клик по кнопке Настройки');
        vscode.postMessage({ type: 'openSettings' });
        openSettingsModal();
      });
    }

    // Закрытие по крестику
    if (closeSettingsModal) {
      closeSettingsModal.addEventListener('click', closeSettingsModalHandler);
    }

    // Закрытие по Отмена
    if (cancelSettings) {
      cancelSettings.addEventListener('click', closeSettingsModalHandler);
    }

    // Закрытие по клику на overlay
    if (settingsModal) {
      settingsModal.addEventListener('click', function (e) {
        if (e.target === settingsModal) {
          closeSettingsModalHandler();
        }
      });
    }

    // Закрытие по Escape
    document.addEventListener('keydown', function (e) {
      const modal = document.getElementById('settingsModal');
      if (e.key === 'Escape' && modal && modal.classList.contains('active')) {
        closeSettingsModalHandler();
      }
    });

    // Сохранение настроек
    if (saveSettings) {
      saveSettings.addEventListener('click', function () {
        const baseUrlEl = document.getElementById('settingsBaseUrl');
        const apiKeyEl = document.getElementById('settingsApiKey');
        const customModelEl = document.getElementById('settingsCustomModel');
        const modelSelectEl = document.getElementById('settingsModelSelect');
        const maxRetriesEl = document.getElementById('settingsMaxRetries');
        const systemPromptEl = document.getElementById('settingsSystemPrompt');
        const debugModeEl = document.getElementById('settingsDebugMode');

        const baseUrl = baseUrlEl ? baseUrlEl.value.trim() : '';
        const apiKey = apiKeyEl ? apiKeyEl.value.trim() : '';
        const model =
          (customModelEl ? customModelEl.value.trim() : '') ||
          (modelSelectEl ? modelSelectEl.value : '');
        const maxRetries = parseInt(maxRetriesEl ? maxRetriesEl.value || '3' : '3', 10);
        const systemPrompt = systemPromptEl ? systemPromptEl.value : '';
        const debugMode = debugModeEl ? debugModeEl.checked : false;

        if (!baseUrl) {
          alert('⚠️ Base URL не может быть пустым');
          return;
        }
        if (!apiKey) {
          alert('⚠️ API Key не может быть пустым');
          return;
        }
        if (!model) {
          alert('⚠️ Модель не может быть пустой');
          return;
        }

        const settings = {
          baseUrl: baseUrl,
          apiKey: apiKey,
          model: model,
          maxRetries: maxRetries,
          systemPrompt: systemPrompt,
          debugMode: debugMode,
        };

        console.log('[Devil] Сохранение настроек:', settings);
        vscode.postMessage({
          type: 'saveSettings',
          settings: settings,
        });

        closeSettingsModalHandler();
      });
    }
  }

  // ========================================
  // Command Dropdown
  // ========================================
  function initCommandDropdown() {
    console.log('[Devil] Command Dropdown инициализирован');

    var COMMANDS = [
      // Справка
      { name: '/help', desc: 'Список всех команд и справка' },

      // Анализ кода
      { name: '/explain', desc: 'Объяснить код файла или выделенного фрагмента' },
      { name: '/refactor', desc: 'Предложить рефакторинг кода (SOLID, паттерны)' },
      { name: '/scan', desc: 'Сканировать файл и показать содержимое' },

      // Поиск
      { name: '/search', desc: 'Полнотекстовый поиск по проекту' },
      { name: '/whereis', desc: 'Найти все использования символа в проекте' },
      { name: '/semsearch', desc: 'Семантический поиск по памяти' },
      { name: '/memory embeddings build', desc: 'Векторизовать узлы графа' },
      { name: '/memory embeddings rebuild', desc: 'Перестроить embeddings' },

      // Генерация
      { name: '/dev generate', desc: 'Сгенерировать план разработки' },
      { name: '/dev next', desc: 'Выполнить следующий шаг плана' },
      { name: '/dev status', desc: 'Показать прогресс выполнения плана' },
      { name: '/dev skip [id]', desc: 'Пропустить шаг плана' },
      { name: '/dev reset', desc: 'Сбросить план разработки' },
      { name: '/dev reference add', desc: 'Добавить reference-файл' },
      { name: '/dev reference list', desc: 'Показать reference-файлы' },
      { name: '/dev reference remove', desc: 'Удалить reference-файл' },
      { name: '/roadmap generate', desc: 'Сгенерировать Roadmap проекта' },
      { name: '/roadmap update', desc: 'Перегенерировать Roadmap с сохранением истории' },
      { name: '/checklist generate', desc: 'Сгенерировать чек-лист на основе Roadmap' },
      { name: '/checklist sync', desc: 'Синхронизировать чек-лист с реальной структурой проекта' },
      { name: '/test generate', desc: 'Сгенерировать юнит-тесты для файла (или /test <путь>)' },

      // Git
      { name: '/diff', desc: 'Получить diff между коммитами Git' },
      { name: '/git', desc: 'Git-операции (log, status, branch)' },

      // Память
      { name: '/memory show', desc: 'Показать графовую память проекта' },
      { name: '/memory add', desc: 'Добавить узел в графовую память' },
      { name: '/memory delete', desc: 'Удалить узел из графовой памяти' },

      // Инструменты
      { name: '/lint', desc: 'Запустить линтер и показать отчёт' },
      { name: '/rebuild', desc: 'Перестроить индекс поиска и граф' },
    ];

    var commandButton = document.getElementById('commandButton');
    var commandDropdown = document.getElementById('commandDropdown');
    var commandSearch = document.getElementById('commandSearch');
    var commandList = document.getElementById('commandList');

    if (!commandButton || !commandDropdown || !commandSearch || !commandList) {
      console.warn('[Devil] Отсутствуют элементы command dropdown');
      return;
    }

    var selectedCommandIndex = 0;
    var filteredCommands = COMMANDS.slice();

    function renderCommands(filter) {
      if (!filter) filter = '';
      var filterLower = filter.toLowerCase();

      filteredCommands = COMMANDS.filter(function (cmd) {
        return (
          cmd.name.toLowerCase().indexOf(filterLower) !== -1 ||
          cmd.desc.toLowerCase().indexOf(filterLower) !== -1
        );
      });

      if (filteredCommands.length === 0) {
        commandList.innerHTML = '<div class="command-list-empty">Команды не найдены</div>';
        return;
      }

      commandList.innerHTML = filteredCommands
        .map(function (cmd, index) {
          var selectedClass = index === selectedCommandIndex ? 'selected' : '';
          return (
            '<div class="command-list-item ' +
            selectedClass +
            '" data-command="' +
            cmd.name +
            '" data-index="' +
            index +
            '">' +
            '<span class="command-name">' +
            cmd.name +
            '</span>' +
            '<span class="command-desc">' +
            cmd.desc +
            '</span>' +
            '</div>'
          );
        })
        .join('');

      var items = commandList.querySelectorAll('.command-list-item');
      items.forEach(function (item) {
        item.addEventListener('click', function () {
          insertCommand(item.getAttribute('data-command'));
        });
      });
    }

    function insertCommand(command) {
      if (messageInput) {
        messageInput.value = command + ' ';
        messageInput.focus();
        closeCommandDropdown();
      }
    }

    function openCommandDropdown() {
      commandDropdown.style.display = 'flex';
      commandSearch.value = '';
      selectedCommandIndex = 0;
      renderCommands();
      setTimeout(function () {
        commandSearch.focus();
      }, 50);
    }

    function closeCommandDropdown() {
      commandDropdown.style.display = 'none';
    }

    function updateSelectedCommand() {
      var items = commandList.querySelectorAll('.command-list-item');
      items.forEach(function (item, index) {
        if (index === selectedCommandIndex) {
          item.classList.add('selected');
          item.scrollIntoView({ block: 'nearest' });
        } else {
          item.classList.remove('selected');
        }
      });
    }

    // Клик по кнопке открытия
    commandButton.addEventListener('click', function (e) {
      e.stopPropagation();
      if (commandDropdown.style.display === 'none' || !commandDropdown.style.display) {
        openCommandDropdown();
      } else {
        closeCommandDropdown();
      }
    });

    // Поиск и навигация
    commandSearch.addEventListener('input', function (e) {
      selectedCommandIndex = 0;
      renderCommands(e.target.value);
    });

    commandSearch.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedCommandIndex = Math.min(selectedCommandIndex + 1, filteredCommands.length - 1);
        updateSelectedCommand();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedCommandIndex = Math.max(selectedCommandIndex - 1, 0);
        updateSelectedCommand();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredCommands[selectedCommandIndex]) {
          insertCommand(filteredCommands[selectedCommandIndex].name);
        }
      } else if (e.key === 'Escape') {
        closeCommandDropdown();
      }
    });

    // Закрытие по клику вне dropdown
    document.addEventListener('click', function (e) {
      if (
        commandDropdown.style.display === 'flex' &&
        !commandDropdown.contains(e.target) &&
        e.target !== commandButton
      ) {
        closeCommandDropdown();
      }
    });
  }

  // ========================================
  // Заглушки и помощники
  // ========================================
  function setupFileLinkHandlers() {
    var links = document.querySelectorAll('.message-text a');
    links.forEach(function (link) {
      var href = link.getAttribute('href');
      if (href && href.indexOf('vscode://file/') === 0) {
        link.addEventListener('click', function (e) {
          e.preventDefault();
          var url = href.substring('vscode://file/'.length);
          var lineMatch = url.match(/:(\d+)$/);
          var filePath = url;
          var line = 1;

          if (lineMatch) {
            line = parseInt(lineMatch[1], 10);
            filePath = url.substring(0, url.lastIndexOf(':'));
          }

          vscode.postMessage({
            type: 'openFile',
            filePath: filePath,
            line: line,
          });
        });
      }
    });
  }

  function loadSettingsIntoUI(settings) {
    console.log('[Devil] loadSettingsIntoUI', settings);

    var baseUrlInput = document.getElementById('settingsBaseUrl');
    var apiKeyInput = document.getElementById('settingsApiKey');
    var modelInput = document.getElementById('settingsCustomModel');
    var maxRetriesInput = document.getElementById('settingsMaxRetries');
    var systemPromptInput = document.getElementById('settingsSystemPrompt');
    var debugModeInput = document.getElementById('settingsDebugMode');

    if (baseUrlInput) baseUrlInput.value = settings.baseUrl || '';
    if (apiKeyInput) apiKeyInput.value = settings.apiKey || '';
    if (modelInput) modelInput.value = settings.model || '';
    if (maxRetriesInput)
      maxRetriesInput.value = settings.maxRetries != null ? settings.maxRetries : 3;
    if (systemPromptInput) systemPromptInput.value = settings.systemPrompt || '';
    if (debugModeInput) debugModeInput.checked = !!settings.debugMode;
  }

  function populateModelSelect(models, currentModel) {
    var modelSelect = document.getElementById('settingsModelSelect');
    if (!modelSelect) return;

    modelSelect.innerHTML = '<option value="">-- Выберите модель --</option>';

    if (!models || models.length === 0) {
      return;
    }

    models.forEach(function (model) {
      var option = document.createElement('option');
      // model — это объект ModelConfig с полями id, name, model, baseUrl и т.д.
      option.value = model.model || model;
      option.textContent =
        (model.name || model.model || model) + ' (' + (model.model || model) + ')';
      if ((model.model || model) === currentModel) {
        option.selected = true;
      }
      modelSelect.appendChild(option);
    });

    // Синхронизируем с полем ручного ввода
    var customModelInput = document.getElementById('settingsCustomModel');
    if (customModelInput && !customModelInput.value && currentModel) {
      customModelInput.value = currentModel;
    }
  }

  // Обработчик изменения dropdown — синхронизация с полем ввода
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'settingsModelSelect') {
      var customModelInput = document.getElementById('settingsCustomModel');
      if (customModelInput && e.target.value) {
        customModelInput.value = e.target.value;
      }
    }
  });

  // ========================================
  // Запуск
  // ========================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }
})();
