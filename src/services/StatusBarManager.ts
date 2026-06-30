import * as vscode from 'vscode';
import { IMultiModelManager } from '../interfaces/IMultiModelManager';
import { ILLMProvider } from '../interfaces/ILLMProvider';
import { logger } from '../utils/logger';

/**
 * StatusBarManager — управление StatusBar Item для выбора модели LLM.
 *
 * Отображает текущую активную модель в нижней панели VS Code.
 * При клике показывает QuickPick со списком доступных моделей.
 */
export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;

  constructor(
    private readonly multiModelManager: IMultiModelManager,
    private readonly llmProvider: ILLMProvider
  ) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = 'devil.selectModel';
    this.updateStatusBar();
    this.statusBarItem.show();

    logger.info('StatusBarManager инициализирован', 'StatusBarManager');
  }

  /**
   * Обновляет текст и tooltip StatusBar Item на основе текущей модели.
   */
  public updateStatusBar(): void {
    const currentModel = this.multiModelManager.getCurrentModel();
    if (currentModel) {
      this.statusBarItem.text = `$(robot) ${currentModel.name}`;
      this.statusBarItem.tooltip = new vscode.MarkdownString(
        `**Модель:** ${currentModel.name}\n\n` +
        `**API Model:** \`${currentModel.model}\`\n\n` +
        `**Base URL:** \`${currentModel.baseUrl}\`\n\n` +
        `**Задачи:** ${currentModel.taskTypes.join(', ')}\n\n` +
        '---\n\n' +
        'Кликните для переключения модели'
      );
    } else {
      this.statusBarItem.text = '$(robot) Devil';
      this.statusBarItem.tooltip = new vscode.MarkdownString(
        '**Модель не выбрана**\n\nКликните для выбора модели.'
      );
    }
  }

  /**
   * Показывает QuickPick со списком моделей для переключения.
   */
  public async showModelPicker(): Promise<void> {
    const models = this.multiModelManager.getAvailableModels();
    const currentId = this.multiModelManager.getCurrentModelId();

    if (models.length === 0) {
      vscode.window.showErrorMessage(
        'Нет настроенных моделей. Добавьте модели в настройках Devil (devil.models).'
      );
      return;
    }

    const items = models.map(model => ({
      label: model.name,
      description: model.model,
      detail: `ID: ${model.id} | Задачи: ${model.taskTypes.join(', ')}`,
      id: model.id,
      picked: model.id === currentId
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Выберите модель для Devil',
      title: 'Переключение модели LLM',
      matchOnDescription: true,
      matchOnDetail: true
    });

    if (selected) {
      try {
        this.multiModelManager.switchModel(selected.id);
        const newModel = this.multiModelManager.getCurrentModel();
        if (newModel) {
          this.llmProvider.applyModelConfig(newModel);
        }
        this.updateStatusBar();
        vscode.window.showInformationMessage(`✅ Модель переключена на ${selected.label}`);
        logger.info('Модель переключена: ' + selected.label, 'StatusBarManager');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage('Ошибка переключения модели: ' + errorMessage);
        logger.error('Ошибка переключения модели', error, 'StatusBarManager');
      }
    }
  }

  /**
   * Освобождает ресурсы StatusBar Item.
   */
  public dispose(): void {
    this.statusBarItem.dispose();
    logger.info('StatusBarManager остановлен', 'StatusBarManager');
  }
}
