(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  const messageInput = document.getElementById('messageInput');
  const sendButton = document.getElementById('sendButton'); // Убрано дублирование
  const messagesArea = document.getElementById('messagesArea');

  // Загружаем историю из state
  const savedState = vscode.getState();
  if (savedState && savedState.messages) {
    savedState.messages.forEach(function (msg) {
      addMessage(msg.role, msg.content, false); // false — не сохранять повторно
    });
  }

  // Инициализация marked (без падений)
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
    // Сброс состояния + приветствие
    const welcomeMessage = {
      role: 'assistant',
      content:
        'Привет! Я Devil — твой интеллектуальный ассистент для разработки. ' +
        'Я могу помочь с генерацией кода, объяснением, рефакторингом и анализом проекта.',
    };

    vscode.setState({ messages: [welcomeMessage] }); // Сохраняем приветствие
    messagesArea.innerHTML = '';
    addMessage('assistant', welcomeMessage.content, false); // false — не сохранять в цикле
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
      addCopyButtons(messageDiv); // Добавляет кнопки только для новых блоков <code>
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
    }
  });
})();
