import * as vscode from 'vscode';

/**
 * Точка входа расширения Devil.
 * Вызывается VS Code при активации расширения.
 *
 * На данном этапе (Sprint 0) — минимальный скелет.
 * В Sprint 1 здесь будут зарегистрированы команды:
 *   - devil.openChat
 *   - devil.openProject
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log('Devil extension is now active!');

  // Временная команда для проверки активации расширения
  const disposable = vscode.commands.registerCommand('devil.hello', () => {
    vscode.window.showInformationMessage('Devil: расширение работает!');
  });

  context.subscriptions.push(disposable);
}

/**
 * Вызывается VS Code при деактивации расширения.
 * Здесь можно освобождать ресурсы (закрыть БД, отписаться от watcher'ов).
 */
export function deactivate(): void {
  console.log('Devil extension deactivated.');
}
