import * as vscode from 'vscode';
import { logger } from '../utils/logger';
import { LLMProvider } from '../services/LLMProvider';
import { ContextBuilder } from '../services/ContextBuilder';
import { ProjectManager } from '../services/ProjectManager';
import { FileSystemService } from '../services/FileSystemService';
import { MemoryStore } from '../services/MemoryStore';
import { GitService } from '../services/GitService';
import { CommandHandler } from '../commands/CommandHandler';
import { HistoryManager } from '../services/HistoryManager';

export interface WebviewMessage {
  type: string;
  content?: string;
  text?: string;
  [key: string]: unknown;
}

export interface ExtensionMessage {
  type: 'agentResponse' | 'error' | 'history' | 'commandResult' | 'executeCommand';
  content?: string;
  text?: string;
  messages?: Array<{ role: string; content: string }>;
}

export class ChatPanel {
  public static currentPanel: ChatPanel | undefined;
  public static readonly viewType = 'devilChat';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  private readonly llmProvider: LLMProvider;
  private readonly contextBuilder: ContextBuilder;
  private readonly projectManager: ProjectManager;
  private readonly fileSystemService: FileSystemService;
  private readonly memoryStore: MemoryStore;
  private readonly gitService: GitService;
  private readonly commandHandler: CommandHandler;
  private readonly historyManager: HistoryManager;

  public static createOrShow(
    extensionUri: vscode.Uri,
    llmProvider: LLMProvider,
    contextBuilder: ContextBuilder,
    projectManager: ProjectManager,
    fileSystemService: FileSystemService,
    memoryStore: MemoryStore,
    gitService: GitService
  ): ChatPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel._panel.reveal(column);
      return ChatPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      ChatPanel.viewType,
      'Devil Chat',
      column || vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'webview'),
          vscode.Uri.joinPath(extensionUri, 'node_modules')
        ]
      }
    );

    ChatPanel.currentPanel = new ChatPanel(
      panel,
      extensionUri,
      llmProvider,
      contextBuilder,
      projectManager,
      fileSystemService,
      memoryStore,
      gitService
    );
    return ChatPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    llmProvider: LLMProvider,
    contextBuilder: ContextBuilder,
    projectManager: ProjectManager,
    fileSystemService: FileSystemService,
    memoryStore: MemoryStore,
    gitService: GitService
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this.llmProvider = llmProvider;
    this.contextBuilder = contextBuilder;
    this.projectManager = projectManager;
    this.fileSystemService = fileSystemService;
    this.memoryStore = memoryStore;
    this.gitService = gitService;
    this.commandHandler = new CommandHandler(
      fileSystemService,
      llmProvider,
      contextBuilder,
      projectManager,
      memoryStore,
      gitService
    );
    this.historyManager = new HistoryManager();

    this._initializeHistory();
    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        await this._handleMessage(message);
      },
      null,
      this._disposables
    );

    logger.info('ChatPanel создан', 'ChatPanel');
  }

  private async _initializeHistory(): Promise<void> {
    const project = this.projectManager.getCurrentProject();
    if (project) {
      try {
        await this.historyManager.initialize(project.path);
        const messages = this.historyManager.getMessages();
        if (messages.length > 0) {
          this.sendMessage({
            type: 'history',
            messages: messages.map(m => ({ role: m.role, content: m.content }))
          });
        }
      } catch (error) {
        logger.error('Не удалось инициализировать HistoryManager', error, 'ChatPanel');
      }
    }
  }

  private async _handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'userMessage': {
        const content = message.content || '';
        logger.info('Получено сообщение: ' + content.substring(0, 50), 'ChatPanel');

        await this.historyManager.addMessage('user', content);

        const commandResult = await this.commandHandler.handleMessage(content);
        if (commandResult) {
          await this.historyManager.addMessage('assistant', commandResult.message, {
            command: commandResult.success ? 'success' : 'error'
          });
          this.sendMessage({
            type: 'agentResponse',
            content: commandResult.message
          });
          return;
        }

        await this._processUserMessage(content);
        break;
      }
      case 'executeCommand': {
        if (message.content) {
          logger.info('Выполнение команды из контекстного меню', 'ChatPanel');
          await this._handleMessage({ type: 'userMessage', content: message.content });
        }
        break;
      }
      case 'clearHistory': {
        await this.historyManager.clearHistory();
        logger.info('История очищена', 'ChatPanel');
        break;
      }
      case 'alert': {
        if (message.text) {
          vscode.window.showErrorMessage(message.text);
        }
        break;
      }
    }
  }

  private async _processUserMessage(content: string): Promise<void> {
    try {
      const context = await this.contextBuilder.buildContext(content, {
        includeProjectStructure: true,
        includeRoadmap: true,
        includeChecklist: true,
        includeMemoryGraph: false
      });

      logger.info(
        'Контекст построен (длина: ' + context.systemPrompt.length + ' символов)',
        'ChatPanel'
      );

      const response = await this.llmProvider.generate(content, {
        systemPrompt: context.systemPrompt
      });

      logger.info('Получен ответ от LLM (токенов: ' + response.tokensUsed + ')', 'ChatPanel');

      await this.historyManager.addMessage('assistant', response.content, {
        tokensUsed: response.tokensUsed,
        model: response.model
      });

      this.sendMessage({
        type: 'agentResponse',
        content: response.content
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Ошибка при обработке сообщения', error, 'ChatPanel');

      await this.historyManager.addMessage('assistant', 'Ошибка: ' + errorMessage);

      this.sendMessage({
        type: 'error',
        text: errorMessage
      });
    }
  }

  public sendMessage(message: ExtensionMessage): void {
    this._panel.webview.postMessage(message);
  }

  public dispose(): void {
    ChatPanel.currentPanel = undefined;
    this._panel.dispose();

    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }

    logger.info('ChatPanel остановлен', 'ChatPanel');
  }

  private _update(): void {
    const webview = this._panel.webview;
    this._panel.title = 'Devil Chat';
    this._panel.webview.html = this._getHtmlForWebview(webview);
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'webview', 'chat.css')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'webview', 'chat.js')
    );
    const markedUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'marked', 'lib', 'marked.umd.js')
    );
    const highlightUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'highlight.js', 'lib', 'core.js')
    );
    const highlightLangTypescript = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'highlight.js', 'lib', 'languages', 'typescript.js')
    );
    const highlightLangJavascript = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'highlight.js', 'lib', 'languages', 'javascript.js')
    );
    const highlightLangPython = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'highlight.js', 'lib', 'languages', 'python.js')
    );
    const highlightLangJson = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'highlight.js', 'lib', 'languages', 'json.js')
    );
    const highlightLangBash = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'highlight.js', 'lib', 'languages', 'bash.js')
    );
    const highlightLangSql = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'highlight.js', 'lib', 'languages', 'sql.js')
    );
    const highlightStylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'highlight.js', 'styles', 'github-dark.css')
    );

    const nonce = getNonce();

    const csp = [
      "default-src 'none'",
      'style-src ' + webview.cspSource,
      "script-src 'nonce-" + nonce + "'",
      'font-src ' + webview.cspSource,
      'img-src ' + webview.cspSource + ' https:',
      'connect-src https:'
    ].join('; ');

    return '<!DOCTYPE html>' +
      '<html lang="ru">' +
      '<head>' +
      '    <meta charset="UTF-8">' +
      '    <meta name="viewport" content="width=device-width, initial-scale=1.0">' +
      '    <meta http-equiv="Content-Security-Policy" content="' + csp + '">' +
      '    <title>Devil Chat</title>' +
      '    <link rel="stylesheet" href="' + styleUri + '">' +
      '    <link rel="stylesheet" href="' + highlightStylesUri + '">' +
      '</head>' +
      '<body>' +
      '    <div class="chat-container">' +
      '        <div class="chat-header">' +
      '            <div class="project-info">' +
      '                <span class="project-icon">📁</span>' +
      '                <span class="project-name">devil</span>' +
      '                <span class="project-path">Загрузка...</span>' +
      '            </div>' +
      '            <div class="header-actions">' +
      '                <button class="icon-button" title="Очистить историю">🗑️</button>' +
      '                <button class="icon-button" title="Настройки">⚙️</button>' +
      '            </div>' +
      '        </div>' +
      '        <div class="messages-area" id="messagesArea">' +
      '            <div class="message system-message">' +
      '                <div class="message-avatar">🤖</div>' +
      '                <div class="message-content">' +
      '                    <div class="message-text">' +
      '                        Привет! Я Devil — твой интеллектуальный ассистент для разработки. ' +
      '                        Я могу помочь с генерацией кода, объяснением, рефакторингом и анализом проекта.' +
      '                    </div>' +
      '                </div>' +
      '            </div>' +
      '        </div>' +
      '        <div class="input-area">' +
      '            <div class="input-container">' +
      '                <textarea ' +
      '                    id="messageInput" ' +
      '                    class="message-input" ' +
      '                    placeholder="Введите сообщение или команду (например, /help, /explain, /roadmap)..." ' +
      '                    rows="3"' +
      '                ></textarea>' +
      '                <button class="send-button" id="sendButton" title="Отправить (Enter)">' +
      '                    <span class="send-icon">➤</span>' +
      '                </button>' +
      '            </div>' +
      '            <div class="input-hints">' +
      '                <span class="hint">💡 Команды: /help, /scan, /diff, /whereis, /roadmap generate, /checklist generate, /explain</span>' +
      '            </div>' +
      '        </div>' +
      '    </div>' +
      '    <script nonce="' + nonce + '" src="' + markedUri + '"></script>' +
      '    <script nonce="' + nonce + '" src="' + highlightUri + '"></script>' +
      '    <script nonce="' + nonce + '" src="' + highlightLangTypescript + '"></script>' +
      '    <script nonce="' + nonce + '" src="' + highlightLangJavascript + '"></script>' +
      '    <script nonce="' + nonce + '" src="' + highlightLangPython + '"></script>' +
      '    <script nonce="' + nonce + '" src="' + highlightLangJson + '"></script>' +
      '    <script nonce="' + nonce + '" src="' + highlightLangBash + '"></script>' +
      '    <script nonce="' + nonce + '" src="' + highlightLangSql + '"></script>' +
      '    <script nonce="' + nonce + '" src="' + scriptUri + '"></script>' +
      '</body>' +
      '</html>';
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
