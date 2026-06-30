(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  const messageInput = document.getElementById('messageInput');
  const sendButton = document.getElementById('sendButton');
  const messagesArea = document.getElementById('messagesArea');

  // Загружаем историю из state
  const savedState = vscode.getState();
  if (savedState && savedState.messages) {
    savedState.messages.forEach(function (msg) {
      addMessage(msg.role, msg.content, false);
    });
  }

  // Инициализация marked
  const markedAvailable = typeof marked !== 'undefined';
  const hljsAvailable = typeof hljs !== 'undefined';

  if (markedAvailable) {
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
            console.error('Highlight error:', err);
          }
        }
        return code;
      },
    });
  }

  // Кнопка очистки
  const clearButton = document.querySelector('.header-actions button[title="Очистить историю"]');
  if (clearButton) {
    clearButton.addEventListener('click', clearHistory);
  }

  // Auto-resize textarea
  messageInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 200) + 'px';
  });

  // Отправка по Enter
  messageInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendButton.addEventListener('click', sendMessage);

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
          navigator.clipboard.writeText(codeBlock.textContent).then(function () {
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

  window.addEventListener('message', function (event) {
    const message = event.data;

    switch (message.type) {
      case 'agentResponse':
        removeLoadingIndicator();
        addMessage('assistant', message.content);
        setTimeout(() => setupFileLinkHandlers(), 100);
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
        messageInput.value = message.content;
        sendMessage();
        break;
      case 'loadSettings':
        console.log('[Devil] Загружены настройки:', message.settings);
        document.getElementById('settingsBaseUrl').value = message.settings.baseUrl || '';
        document.getElementById('settingsApiKey').value = message.settings.apiKey || '';
        document.getElementById('settingsModel').value = message.settings.model || '';
        document.getElementById('settingsMaxRetries').value = message.settings.maxRetries || 3;
        document.getElementById('settingsSystemPrompt').value = message.settings.systemPrompt || '';
        document.getElementById('settingsDebugMode').checked = message.settings.debugMode || false;
        break;
    }
  });

  function setupFileLinkHandlers() {
    const links = document.querySelectorAll('a');
    links.forEach((link) => {
      const href = link.getAttribute('href');
      if (href && href.startsWith('vscode://file/')) {
        link.addEventListener('click', function (e) {
          e.preventDefault();
          const url = href.substring('vscode://file/'.length);
          const lineMatch = url.match(/:(\d+)$/);
          let filePath = url;
          let line = 1;

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

  setTimeout(() => setupFileLinkHandlers(), 300);

  // ========================================
  // Settings Modal — ВНУТРИ IIFE!
  // ========================================
  console.log('[Devil] Инициализация модалки настроек...');

  const settingsButton = document.querySelector('.header-actions button[title="Настройки"]');
  const settingsModal = document.getElementById('settingsModal');
  const closeSettingsModal = document.getElementById('closeSettingsModal');
  const cancelSettings = document.getElementById('cancelSettings');
  const saveSettings = document.getElementById('saveSettings');

  console.log('[Devil] settingsButton:', settingsButton);
  console.log('[Devil] settingsModal:', settingsModal);

  function openSettingsModal() {
    if (settingsModal) {
      settingsModal.classList.add('active');
      console.log('[Devil] Модалка открыта');
    }
  }

  function closeSettingsModalHandler() {
    if (settingsModal) {
      settingsModal.classList.remove('active');
      console.log('[Devil] Модалка закрыта');
    }
  }

  if (settingsButton) {
    settingsButton.addEventListener('click', () => {
      console.log('[Devil] Клик по кнопке Настройки');
      vscode.postMessage({ type: 'openSettings' });
      openSettingsModal();
    });
  }

  if (closeSettingsModal) {
    closeSettingsModal.addEventListener('click', closeSettingsModalHandler);
  }

  if (cancelSettings) {
    cancelSettings.addEventListener('click', closeSettingsModalHandler);
  }

  if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        closeSettingsModalHandler();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsModal && settingsModal.classList.contains('active')) {
      closeSettingsModalHandler();
    }
  });

  if (saveSettings) {
    saveSettings.addEventListener('click', () => {
      const baseUrl = document.getElementById('settingsBaseUrl').value.trim();
      const apiKey = document.getElementById('settingsApiKey').value.trim();
      const model = document.getElementById('settingsModel').value.trim();
      const maxRetries = parseInt(document.getElementById('settingsMaxRetries').value, 10);
      const systemPrompt = document.getElementById('settingsSystemPrompt').value;
      const debugMode = document.getElementById('settingsDebugMode').checked;

      // Валидация
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
      try {
        new URL(baseUrl);
      } catch (e) {
        alert('⚠️ Неверный формат Base URL');
        return;
      }
      if (isNaN(maxRetries) || maxRetries < 1 || maxRetries > 10) {
        alert('⚠️ Максимум попыток должен быть от 1 до 10');
        return;
      }

      const settings = {
        baseUrl,
        apiKey,
        model,
        maxRetries,
        systemPrompt,
        debugMode,
      };

      console.log('[Devil] Сохранение настроек:', settings);

      vscode.postMessage({
        type: 'saveSettings',
        settings: settings,
      });

      closeSettingsModalHandler();
    });
  }
})();
