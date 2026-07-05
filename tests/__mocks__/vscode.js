/**
 * Мок для модуля vscode (чистый JavaScript)
 * Используется в тестах для изоляции от VS Code API
 */

// Хранилище конфигурации для тестов
const configStore = {};

// Вспомогательные методы для управления конфигурацией в тестах
const __clearConfig = () => {
  Object.keys(configStore).forEach((key) => delete configStore[key]);
};

const __setConfigValue = (key, value) => {
  configStore[key] = value;
};

const __getConfigValue = (key, defaultValue) => {
  return key in configStore ? configStore[key] : defaultValue;
};

const window = {
  createOutputChannel: jest.fn(() => ({
    appendLine: jest.fn(),
    append: jest.fn(),
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
    clear: jest.fn(),
  })),
  showInformationMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  showErrorMessage: jest.fn(),
  showQuickPick: jest.fn(),
  showInputBox: jest.fn(),
  createTerminal: jest.fn(() => ({
    sendText: jest.fn(),
    show: jest.fn(),
    dispose: jest.fn(),
  })),
  activeTextEditor: undefined,
  visibleTextEditors: [],
  onDidChangeActiveTextEditor: jest.fn(),
  withProgress: jest.fn((options, task) => task({ report: jest.fn() })),
  createStatusBarItem: jest.fn(() => ({
    text: '',
    tooltip: '',
    command: undefined,
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
  })),
};

const workspace = {
  workspaceFolders: [],
  getConfiguration: jest.fn((section) => ({
    get: jest.fn((key, defaultValue) => {
      const fullKey = section ? `${section}.${key}` : key;
      return __getConfigValue(fullKey, defaultValue);
    }),
    update: jest.fn(),
    has: jest.fn((key) => {
      const fullKey = section ? `${section}.${key}` : key;
      return fullKey in configStore;
    }),
    inspect: jest.fn(),
  })),
  onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
  openTextDocument: jest.fn(),
  saveAll: jest.fn(),
  createFileSystemWatcher: jest.fn(() => ({
    onDidCreate: jest.fn(() => ({ dispose: jest.fn() })),
    onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    onDidDelete: jest.fn(() => ({ dispose: jest.fn() })),
    dispose: jest.fn(),
  })),
  fs: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    stat: jest.fn(),
    readDirectory: jest.fn(),
    createDirectory: jest.fn(),
    delete: jest.fn(),
  },
};

const commands = {
  registerCommand: jest.fn(),
  executeCommand: jest.fn(),
  getCommands: jest.fn(),
};

const Uri = jest.fn().mockImplementation((scheme, authority, path, query, fragment) => ({
  scheme: scheme || 'file',
  authority: authority || '',
  path: path || '',
  query: query || '',
  fragment: fragment || '',
  fsPath: path || '',
  with: jest.fn(),
  toString: jest.fn(() => `${scheme || 'file'}://${path || ''}`),
}));
Uri.file = jest.fn((path) => ({
  scheme: 'file',
  authority: '',
  path,
  query: '',
  fragment: '',
  fsPath: path,
  with: jest.fn(),
  toString: jest.fn(() => `file://${path}`),
}));
Uri.parse = jest.fn((uri) => ({
  scheme: 'file',
  authority: '',
  path: uri,
  query: '',
  fragment: '',
  fsPath: uri,
  with: jest.fn(),
  toString: jest.fn(() => `file://${uri}`),
}));
Uri.joinPath = jest.fn((base, ...pathSegments) => ({
  scheme: 'file',
  authority: '',
  path: [base.path || base.fsPath, ...pathSegments].join('/'),
  query: '',
  fragment: '',
  fsPath: [base.path || base.fsPath, ...pathSegments].join('/'),
  with: jest.fn(),
  toString: jest.fn(),
}));

const Position = jest.fn().mockImplementation((line, character) => ({
  line,
  character,
  translate: jest.fn(),
  with: jest.fn(),
  isBefore: jest.fn(),
  isAfter: jest.fn(),
  isEqual: jest.fn(),
  compareTo: jest.fn(),
}));

const Range = jest.fn().mockImplementation((start, end) => ({
  start: start instanceof Position ? start : new Position(start, 0),
  end: end instanceof Position ? end : new Position(end, 0),
  isEmpty: false,
  isSingleLine: false,
  contains: jest.fn(),
  isEqual: jest.fn(),
  intersection: jest.fn(),
  union: jest.fn(),
  with: jest.fn(),
}));

const Location = jest.fn().mockImplementation((uri, range) => ({
  uri,
  range,
}));

const Diagnostic = jest.fn().mockImplementation((range, message, severity) => ({
  range,
  message,
  severity,
  source: undefined,
  code: undefined,
  relatedInformation: undefined,
  tags: undefined,
}));

const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
};

const StatusBarAlignment = {
  Left: 1,
  Right: 2,
};

const ViewColumn = {
  Active: -1,
  Beside: -2,
  One: 1,
  Two: 2,
  Three: 3,
};

const ProgressLocation = {
  SourceControl: 1,
  Window: 10,
  Notification: 15,
};

const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
};

const EventEmitter = jest.fn().mockImplementation(() => ({
  fire: jest.fn(),
  event: jest.fn(),
  dispose: jest.fn(),
}));

const CancellationTokenSource = jest.fn().mockImplementation(() => {
  let cancelled = false;
  const listeners = [];
  return {
    token: {
      get isCancellationRequested() {
        return cancelled;
      },
      onCancellationRequested: jest.fn((listener) => {
        listeners.push(listener);
        return { dispose: jest.fn() };
      }),
    },
    cancel: jest.fn(() => {
      cancelled = true;
      listeners.forEach((l) => l());
    }),
    dispose: jest.fn(),
  };
});

const TreeItem = jest.fn().mockImplementation((label, collapsibleState) => ({
  label,
  collapsibleState,
}));

const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
};

const ThemeIcon = jest.fn().mockImplementation((id) => ({
  id,
}));

const RelativePattern = jest.fn().mockImplementation((base, pattern) => ({
  base: typeof base === 'string' ? base : base.fsPath || base.uri?.fsPath || '',
  pattern,
}));

const FileSystemWatcher = jest.fn().mockImplementation(() => ({
  onDidCreate: jest.fn(() => ({ dispose: jest.fn() })),
  onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
  onDidDelete: jest.fn(() => ({ dispose: jest.fn() })),
  dispose: jest.fn(),
}));

const Disposable = jest.fn().mockImplementation((callOnDispose) => ({
  dispose: jest.fn(() => {
    if (typeof callOnDispose === 'function') callOnDispose();
  }),
}));
Disposable.from = jest.fn((...disposables) => ({
  dispose: jest.fn(() => {
    disposables.forEach((d) => d && d.dispose && d.dispose());
  }),
}));

module.exports = {
  window,
  workspace,
  commands,
  Uri,
  Position,
  Range,
  Location,
  Diagnostic,
  DiagnosticSeverity,
  StatusBarAlignment,
  ViewColumn,
  ProgressLocation,
  ConfigurationTarget,
  EventEmitter,
  CancellationTokenSource,
  TreeItem,
  TreeItemCollapsibleState,
  ThemeIcon,
  RelativePattern,
  FileSystemWatcher,
  Disposable,
  // Специальные методы для управления конфигурацией в тестах
  __clearConfig,
  __setConfigValue,
  __getConfigValue,
};
