/**
 * Мок для модуля vscode (чистый JavaScript, без TypeScript типов)
 * Используется в тестах для изоляции от VS Code API
 */

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
};

const workspace = {
  workspaceFolders: [],
  getConfiguration: jest.fn(() => ({
    get: jest.fn(),
    update: jest.fn(),
    has: jest.fn(),
    inspect: jest.fn(),
  })),
  onDidChangeConfiguration: jest.fn(),
  openTextDocument: jest.fn(),
  saveAll: jest.fn(),
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

const Uri = {
  file: jest.fn((path) => ({ fsPath: path, scheme: 'file' })),
  parse: jest.fn((uri) => ({ fsPath: uri, scheme: 'file' })),
  joinPath: jest.fn((base, ...pathSegments) => ({
    fsPath: [base.fsPath, ...pathSegments].join('/'),
    scheme: 'file',
  })),
};

const Position = jest.fn().mockImplementation((line, character) => ({
  line,
  character,
}));

const Range = jest.fn().mockImplementation((start, end) => ({
  start,
  end,
}));

const Location = jest.fn().mockImplementation((uri, range) => ({
  uri,
  range,
}));

const Diagnostic = jest.fn().mockImplementation((range, message, severity) => ({
  range,
  message,
  severity,
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

const CancellationTokenSource = jest.fn().mockImplementation(() => ({
  token: {
    isCancellationRequested: false,
    onCancellationRequested: jest.fn(),
  },
  cancel: jest.fn(),
  dispose: jest.fn(),
}));

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
};
