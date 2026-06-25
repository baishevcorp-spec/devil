/**
 * Мок модуля 'vscode' для Jest-тестов.
 * 
 * VS Code API недоступно в Node.js-окружении Jest,
 * поэтому мы эмулируем только нужные нам части.
 */

type ConfigStore = Record<string, any>;

const configStore: ConfigStore = {};

export const workspace = {
  getConfiguration: (section?: string) => {
    return {
      get: <T>(key: string, defaultValue?: T): T | undefined => {
        const fullKey = section ? `${section}.${key}` : key;
        return configStore[fullKey] !== undefined ? configStore[fullKey] : defaultValue;
      },
      update: jest.fn()
    };
  },
  onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() }))
};

export const window = {
  createOutputChannel: jest.fn(() => ({
    appendLine: jest.fn(),
    show: jest.fn(),
    dispose: jest.fn()
  })),
  showInformationMessage: jest.fn(),
  showErrorMessage: jest.fn(),
  showWarningMessage: jest.fn()
};

export const commands = {
  registerCommand: jest.fn(() => ({ dispose: jest.fn() }))
};

export class Disposable {
  private callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
  }
  dispose(): void {
    this.callback();
  }
}

/**
 * Вспомогательная функция для тестов: устанавливает значение в мок-хранилище.
 */
export function __setConfigValue(key: string, value: any): void {
  configStore[key] = value;
}

/**
 * Вспомогательная функция для тестов: очищает хранилище.
 */
export function __clearConfig(): void {
  for (const key of Object.keys(configStore)) {
    delete configStore[key];
  }
}
