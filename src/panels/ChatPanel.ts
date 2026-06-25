import * as vscode from 'vscode';
import { logger } from '../utils/logger';
import { LLMProvider } from '../services/LLMProvider';
import { ContextBuilder } from '../services/ContextBuilder';
import { ProjectManager } from '../services/ProjectManager';

/**
 * Сообщение от Webview к Extension.
 */
export interface WebviewMessage {
  type: string;
  content?: string;
  text?: string;
  [key: string]: unknown;
}

/**
 * Сообщение от Extension к Webview.
 */
export interface ExtensionMessage {
  type: 'agentResponse' | 'error';
  content?: string;
  text?: string;
}

/**
 * ChatPanel — управляет Webview-панелью чата.
 */
export class ChatPanel {
  public static currentPanel: ChatPanel | undefined;
  public static readonly viewType = 'devilChat';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  
  private llmProvider: LLMProvider;
  private contextBuilder: ContextBuilder;
  private projectManager: ProjectManager;

  public static createOrShow(
    extensionUri: vscode.Uri,
    llmProvider: LLMProvider,
    contextBuilder: ContextBuilder,
    projectManager: ProjectManager
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
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'webview')]
      }
    );

    ChatPanel.currentPanel = new ChatPanel(panel, extensionUri, llmProvider, contextBuilder, projectManager);
    return ChatPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    llmProvider: LLMProvider,
    contextBuilder: ContextBuilder,
    projectManager: ProjectManager
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this.llmProvider = llmProvider;
    this.contextBuilder = contextBuilder;
    this.projectManager = projectManager;

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

  private async _handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'userMessage':
        logger.info('Получено сообщение от пользователя: ' + message.content, 'ChatPanel');
        await this._processUserMessage(message.content || '');
        break;
      case 'alert':
        if (message.text) {
          vscode.window.showErrorMessage(message.text);
        }
        return;
    }
  }

  private async _processUserMessage(content: string): Promise<void> {
    try {
      // Строим контекст
      const context = await this.contextBuilder.buildContext(content, {
        includeProjectStructure: true,
        includeRoadmap: true,
        includeChecklist: true,
        includeMemoryGraph: false // Пока не реализовано
      });

      logger.info('Контекст построен (длина: ' + context.systemPrompt.length + ' символов)', 'ChatPanel');

      // Отправляем запрос к LLM
      const response = await this.llmProvider.generate(content, {
        systemPrompt: context.systemPrompt
      });

      logger.info('Получен ответ от LLM (токенов: ' + response.tokensUsed + ')', 'ChatPanel');

      // Отправляем ответ в Webview
      this.sendMessage({
        type: 'agentResponse',
        content: response.content
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Ошибка при обработке сообщения', error, 'ChatPanel');
      
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
      '                    placeholder="Введите сообщение или команду (например, /explain, /roadmap, /whereis)..." ' +
      '                    rows="3"' +
      '                ></textarea>' +
      '                <button class="send-button" id="sendButton" title="Отправить (Enter)">' +
      '                    <span class="send-icon">➤</span>' +
      '                </button>' +
      '            </div>' +
      '            <div class="input-hints">' +
      '                <span class="hint">💡 Команды: /explain, /refactor, /roadmap, /whereis, /scan</span>' +
      '            </div>' +
      '        </div>' +
      '    </div>' +
      '    <script nonce="' + nonce + '" src="' + scriptUri + '"></script>' +
      '</body>' +
      '</html>';
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.random() * possible.length);
  }
  return text;
}
