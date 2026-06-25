import * as vscode from 'vscode';
import { ConfigManager } from './services/ConfigManager';
import { FileSystemService } from './services/FileSystemService';
import { ProjectManager } from './services/ProjectManager';
import { LLMProvider } from './services/LLMProvider';
import { logger } from './utils/logger';

/**
 * Глобальные экземпляры сервисов.
 */
let configManager: ConfigManager;
let fileSystemService: FileSystemService;
let projectManager: ProjectManager;
let llmProvider: LLMProvider;

/**
 * Точка входа расширения Devil.
 * Вызывается VS Code при активации расширения.
 */
export function activate(context: vscode.ExtensionContext): void {
  logger.info('Devil extension is activating...', 'Extension');

  try {
    // Инициализируем сервисы
    configManager = new ConfigManager();
    configManager.initialize();

    fileSystemService = new FileSystemService();
    projectManager = new ProjectManager(fileSystemService);
    llmProvider = new LLMProvider(configManager);

    // Временная команда для тестирования LLM (будет удалена в Sprint 2)
    const testLLMCommand = vscode.commands.registerCommand('devil.testLLM', async () => {
      try {
        vscode.window.showInformationMessage('Devil: Тестирование LLM...');
        const response = await llmProvider.generate('Привет! Скажи "Привет, мир!" одним предложением.');
        vscode.window.showInformationMessage(`Devil LLM ответ: ${response.content.substring(0, 100)}...`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Devil LLM ошибка: ${message}`);
      }
    });

    // Регистрируем команды
    const helloCommand = vscode.commands.registerCommand('devil.hello', () => {
      vscode.window.showInformationMessage('Devil: расширение работает!');
    });

    const openChatCommand = vscode.commands.registerCommand('devil.openChat', () => {
      vscode.window.showInformationMessage('Devil: Open Chat (будет реализовано в UI-01)');
    });

    const openProjectCommand = vscode.commands.registerCommand('devil.openProject', async () => {
      const result = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Открыть проект'
      });

      if (result && result.length > 0) {
        const folderUri = result[0];
        const folder = vscode.workspace.getWorkspaceFolder(folderUri);
        
        if (folder) {
          await projectManager.setProject(folder);
          const project = projectManager.getCurrentProject();
          vscode.window.showInformationMessage(
            `Devil: Проект "${project!.name}" открыт (${project!.fileCount} файлов)`
          );
        } else {
          vscode.window.showErrorMessage('Devil: Не удалось определить workspace folder');
        }
      }
    });

    // Добавляем команды в subscriptions
    context.subscriptions.push(helloCommand, openChatCommand, openProjectCommand, testLLMCommand);

    // Инициализируем ProjectManager (открываем текущий проект, если есть)
    projectManager.initialize().catch((error) => {
      logger.error('Не удалось инициализировать ProjectManager', error, 'Extension');
    });

    // Добавляем сервисы в subscriptions для автоматической очистки
    context.subscriptions.push(
      new vscode.Disposable(() => {
        configManager.dispose();
        projectManager.dispose();
        logger.dispose();
      })
    );

    logger.info('Devil extension activated successfully!', 'Extension');
  } catch (error) {
    logger.error('Ошибка при активации расширения', error, 'Extension');
    vscode.window.showErrorMessage('Devil: Ошибка при активации расширения. Проверьте Output Channel.');
  }
}

/**
 * Вызывается VS Code при деактивации расширения.
 */
export function deactivate(): void {
  logger.info('Devil extension deactivated.', 'Extension');
}
