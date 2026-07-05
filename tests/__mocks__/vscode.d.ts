/**
 * TypeScript declaration file для мока vscode
 * Расширяет стандартный тип vscode дополнительными тестовыми методами
 */

import * as vscode from 'vscode';

declare module 'vscode' {
  // Тестовые методы для управления конфигурацией
  export function __clearConfig(): void;
  export function __setConfigValue(key: string, value: any): void;
  export function __getConfigValue(key: string, defaultValue?: any): any;
}
