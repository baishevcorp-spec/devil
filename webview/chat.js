// @ts-nocheck
(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();
  
  const messageInput = document.getElementById('messageInput');
  const sendButton = document.getElementById('sendButton');
  const messagesArea = document.getElementById('messagesArea');

  // Инициализация marked
  if (typeof marked !== 'undefined') {
    marked.setOptions({
      breaks: true,
      gfm: true,
      headerIds: false,
      mangle: false,
      highlight: function(code, lang) {
        if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
          try {
            return hljs.highlight(code, { language: lang }).value;
          } catch (err) {
            console.error('Highlight error:', err);
          }
        }
        return code;
      }
    });
  }

  // Auto-resize textarea
  messageInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 200) + 'px';
  });

  // Send message on Enter (Shift+Enter for new line)
  messageInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Send button click
  sendButton.addEventListener('click', sendMessage);

  function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    addMessage('user', text);

    vscode.postMessage({
      type: 'userMessage',
      content: text
    });

    messageInput.value = '';
    messageInput.style.height = 'auto';

    addLoadingIndicator();
  }

  function addMessage(role, content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ' + role + '-message';

    const avatar = role === 'user' ? '👤' : '🤖';
    
    // Рендерим Markdown для ответов агента
    let renderedContent = content;
    if (role === 'assistant' && typeof marked !== 'undefined') {
      renderedContent = marked.parse(content);
    } else {
      renderedContent = escapeHtml(content);
    }
    
    messageDiv.innerHTML = 
      '<div class="message-avatar">' + avatar + '</div>' +
      '<div class="message-content">' +
        '<div class="message-text">' + renderedContent + '</div>' +
      '</div>';

    messagesArea.appendChild(messageDiv);
    messagesArea.scrollTop = messagesArea.scrollHeight;

    // Добавляем кнопки копирования для блоков кода
    if (role === 'assistant') {
      addCopyButtons(messageDiv);
    }
  }

  function addCopyButtons(messageDiv) {
    const codeBlocks = messageDiv.querySelectorAll('pre code');
    codeBlocks.forEach(function(codeBlock) {
      const pre = codeBlock.parentElement;
      if (pre && !pre.querySelector('.copy-button')) {
        const button = document.createElement('button');
        button.className = 'copy-button';
        button.textContent = '📋 Копировать';
        button.onclick = function() {
          navigator.clipboard.writeText(codeBlock.textContent).then(function() {
            button.textContent = '✓ Скопировано';
            setTimeout(function() {
              button.textContent = '📋 Копировать';
            }, 2000);
          });
        };
        
        const wrapper = document.createElement('div');
        wrapper.className = 'code-block-wrapper';
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(button);
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

  // Обработка сообщений от Extension
  window.addEventListener('message', function (event) {
    const message = event.data;
    
    switch (message.type) {
      case 'agentResponse':
        removeLoadingIndicator();
        addMessage('assistant', message.content);
        break;
      case 'error':
        removeLoadingIndicator();
        addMessage('assistant', 'Ошибка: ' + message.text);
        break;
    }
  });
})();
