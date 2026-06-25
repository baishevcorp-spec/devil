import * as vscode from 'vscode';
import { ConfigManager } from './services/ConfigManager';
import { FileSystemService } from './services/FileSystemService';
import { ProjectManager } from './services/ProjectManager';
import { LLMProvider } from './services/LLMProvider';
import { ContextBuilder } from './services/ContextBuilder';
import { ChatPanel } from './panels/ChatPanel';
import { logger } from './utils/logger';

let configManager: ConfigManager;
let fileSystemService: FileSystemService;
let projectManager: ProjectManager;
let llmProvider: LLMProvider;
let contextBuilder: ContextBuilder;

export function activate(context: vscode.ExtensionContext): void {
  logger.info('Devil extension is activating...', 'Extension');

  try {
    configManager = new ConfigManager();
    configManager.initialize();

    fileSystemService = new FileSystemService();
    projectManager = new ProjectManager(fileSystemService);
    llmProvider = new LLMProvider(configManager);
    contextBuilder = new ContextBuilder(projectManager, fileSystemService, null);

    const helloCommand = vscode.commands.registerCommand('devil.hello', () => {
      vscode.window.showInformationMessage('Devil: расширение работает!');
    });

    const openChatCommand = vscode.commands.registerCommand('devil.openChat', () => {
      ChatPanel.createOrShow(context.extensionUri, llmProvider, contextBuilder, projectManager);
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
            'Devil: Проект "' + project!.name + '" открыт (' + project!.fileCount + ' файлов)'
          );
        } else {
          vscode.window.showErrorMessage('Devil: Не удалось определить workspace folder');
        }
      }
    });

    const testLLMCommand = vscode.commands.registerCommand('devil.testLLM', async () => {
      try {
        vscode.window.showInformationMessage('Devil: Тестирование LLM...');
        
        const context = await contextBuilder.buildContext('Привет! Скажи "Привет, мир!" одним предложением.', {
          includeProjectStructure: true,
          includeRoadmap: true,
          includeChecklist: true
        });
        
        logger.info('Контекст построен (длина: ' + context.systemPrompt.length + ' символов)', 'Extension');
        
        const response = await llmProvider.generate('Привет! Скажи "Привет, мир!" одним предложением.', {
          systemPrompt: context.systemPrompt
        });
        
        vscode.window.showInformationMessage('Devil LLM ответ: ' + response.content.substring(0, 100) + '...');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage('Devil LLM ошибка: ' + message);
      }
    });

    context.subscriptions.push(helloCommand, openChatCommand, openProjectCommand, testLLMCommand);

    projectManager.initialize().catch((error) => {
      logger.error('Не удалось инициализировать ProjectManager', error, 'Extension');
    });

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

export function deactivate(): void {
  logger.info('Devil extension deactivated.', 'Extension');
}
