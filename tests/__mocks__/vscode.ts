/**
 * Мок модуля 'vscode' для Jest-тестов.
 *
 * VS Code API недоступно в Node.js-окружении Jest,
 * поэтому мы эмулируем только нужные нам части.
 */

type ConfigStore = Record<string, any>;

const configStore: ConfigStore = {};


// ProgressLocation enum
export enum ProgressLocation {
  SourceControl = 'scm',
  Window = 'window',
  Notification = 15,
}

export class RelativePattern {
  constructor(public base: string, public pattern: string) {}
}

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
  onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
  createFileSystemWatcher: jest.fn(() => ({
    onDidCreate: jest.fn(() => ({ dispose: jest.fn() })),
    onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    onDidDelete: jest.fn(() => ({ dispose: jest.fn() })),
    dispose: jest.fn()
  }))
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
,
    withProgress: jest.fn(async (_options, task) => {
    const progress = { report: jest.fn() };
    const token = { isCancellationRequested: false, onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })) };
    return task(progress, token);
  }),
};


// CancellationTokenSource mock
export class CancellationTokenSource {
  private _cancelled = false;
  private _listeners: Array<() => void> = [];

  get token() {
    return {
      isCancellationRequested: this._cancelled,
      onCancellationRequested: (listener: () => void) => {
        this._listeners.push(listener);
        return { dispose: () => {} };
      }
    };
  }

  cancel() {
    this._cancelled = true;
    this._listeners.forEach(listener => listener());
  }

  dispose() {
    this._listeners = [];
  }
}

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
