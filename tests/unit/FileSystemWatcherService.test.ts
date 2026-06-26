import { FileSystemWatcherService } from '../../src/services/FileSystemWatcherService';

// Mock объявлен внутри factory, чтобы избежать ReferenceError из-за hoisting
jest.mock('vscode', () => {
  const mockWatcher = {
    onDidCreate: jest.fn(),
    onDidChange: jest.fn(),
    onDidDelete: jest.fn(),
    dispose: jest.fn()
  };

  return {
    workspace: {
      createFileSystemWatcher: jest.fn(() => mockWatcher)
    },
    window: {
      createOutputChannel: jest.fn(() => ({
        appendLine: jest.fn(),
        show: jest.fn(),
        dispose: jest.fn()
      }))
    },
    RelativePattern: jest.fn().mockImplementation((base, pattern) => ({ base, pattern }))
  };
});

// Получаем мок-объекты через require после инициализации
const vscode = require('vscode');
const mockWatcher = vscode.workspace.createFileSystemWatcher();

describe('FileSystemWatcherService', () => {
  let watcher: FileSystemWatcherService;
  let mockCallback: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    watcher = new FileSystemWatcherService(500);
    mockCallback = jest.fn();
    watcher.onFileChange(mockCallback);
  });

  afterEach(() => {
    watcher.dispose();
    jest.useRealTimers();
  });

  describe('start', () => {
    it('создаёт FileSystemWatcher', () => {
      watcher.start('/test/project');

      expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalled();
    });

    it('подписывается на события create, change, delete', () => {
      watcher.start('/test/project');

      expect(mockWatcher.onDidCreate).toHaveBeenCalled();
      expect(mockWatcher.onDidChange).toHaveBeenCalled();
      expect(mockWatcher.onDidDelete).toHaveBeenCalled();
    });
  });

  describe('debounce', () => {
    it('debounce события на 500мс', () => {
      watcher.start('/test/project');

      // Получаем callback из onDidChange
      const changeCallback = mockWatcher.onDidChange.mock.calls[0][0];

      // Симулируем событие изменения
      changeCallback({ fsPath: '/test/project/src/test.ts' });

      // Проверяем, что callback ещё не вызван
      expect(mockCallback).not.toHaveBeenCalled();

      // Ждём 500мс
      jest.advanceTimersByTime(500);

      // Теперь callback должен быть вызван
      expect(mockCallback).toHaveBeenCalledWith({
        type: 'change',
        path: '/test/project/src/test.ts'
      });
    });

    it('сбрасывает таймер при повторном событии', () => {
      watcher.start('/test/project');

      const changeCallback = mockWatcher.onDidChange.mock.calls[0][0];

      // Первое событие
      changeCallback({ fsPath: '/test/project/src/test.ts' });
      jest.advanceTimersByTime(300);

      // Второе событие (сбрасывает таймер)
      changeCallback({ fsPath: '/test/project/src/test.ts' });
      jest.advanceTimersByTime(300);

      // Callback ещё не вызван (300 + 300 = 600, но таймер сброшен на 300)
      expect(mockCallback).not.toHaveBeenCalled();

      // Ждём ещё 200мс (итого 500мс от второго события)
      jest.advanceTimersByTime(200);

      expect(mockCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('filtering', () => {
    it('игнорирует файлы с неподдерживаемыми расширениями', () => {
      watcher.start('/test/project');

      const changeCallback = mockWatcher.onDidChange.mock.calls[0][0];

      // Событие для .txt файла
      changeCallback({ fsPath: '/test/project/README.txt' });
      jest.advanceTimersByTime(600);

      // Callback не должен быть вызван
      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('принимает файлы .ts, .tsx, .js, .jsx', () => {
      watcher.start('/test/project');

      const changeCallback = mockWatcher.onDidChange.mock.calls[0][0];

      const extensions = ['.ts', '.tsx', '.js', '.jsx'];

      for (const ext of extensions) {
        changeCallback({ fsPath: '/test/project/src/test' + ext });
        jest.advanceTimersByTime(600);
      }

      expect(mockCallback).toHaveBeenCalledTimes(4);
    });
  });

  describe('stop', () => {
    it('останавливает watcher и очищает таймеры', () => {
      watcher.start('/test/project');

      const changeCallback = mockWatcher.onDidChange.mock.calls[0][0];

      // Событие
      changeCallback({ fsPath: '/test/project/src/test.ts' });

      // Останавливаем
      watcher.stop();

      // Ждём
      jest.advanceTimersByTime(600);

      // Callback не должен быть вызван
      expect(mockCallback).not.toHaveBeenCalled();

      // Watcher должен быть disposed
      expect(mockWatcher.dispose).toHaveBeenCalled();
    });
  });
});
