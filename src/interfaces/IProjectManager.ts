import * as vscode from 'vscode';
import { FileTree } from '../services/FileSystemService';

export interface ProjectInfo {
  name: string;
  path: string;
  devilPath: string;
  fileCount: number;
  structure: FileTree | null; // Дерево файлов проекта
}

export interface FileChangeEvent {
  type: 'created' | 'changed' | 'deleted';
  path: string;
}

/**
 * IProjectManager — интерфейс для управления проектами.
 * 
 * Отвечает за:
 * - Отслеживание текущего проекта
 * - Построение и хранение структуры проекта
 * - Уведомление об изменениях в файлах
 */
export interface IProjectManager {
  /**
   * Получить информацию о текущем проекте
   */
  getCurrentProject(): ProjectInfo | null;

  /**
   * Установить текущий проект
   */
  setProject(folder: vscode.WorkspaceFolder): Promise<void>;

  /**
   * Получить структуру проекта в виде дерева файлов
   */
  getProjectStructure(): FileTree | null;

  /**
   * Получить путь к директории .devil
   */
  getDevilPath(): string | null;

  /**
   * Подписаться на изменения файлов
   */
  onFileChanged(listener: (event: FileChangeEvent) => void): vscode.Disposable;

  /**
   * Инициализация сервиса
   */
  initialize(): Promise<void>;

  /**
   * Освобождение ресурсов
   */
  dispose(): void;
}
