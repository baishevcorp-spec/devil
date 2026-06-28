import { ErrorHandler, ErrorType } from '../../src/utils/ErrorHandler';

describe('ErrorHandler', () => {
  let errorHandler: ErrorHandler;

  beforeEach(() => {
    errorHandler = ErrorHandler.getInstance();
  });

  it('классифицирует сетевые ошибки', () => {
    const error = { code: 'ECONNREFUSED', message: 'Connection refused' };
    const result = errorHandler.classifyError(error);

    expect(result.type).toBe(ErrorType.NETWORK);
    expect(result.userMessage).toContain('интернет-соединение');
  });

  it('классифицирует ошибки LLM (429)', () => {
    const error = { response: { status: 429 }, message: 'Rate limit' };
    const result = errorHandler.classifyError(error);

    expect(result.type).toBe(ErrorType.LLM);
    expect(result.userMessage).toContain('лимит запросов');
  });

  it('классифицирует ошибки аутентификации', () => {
    const error = { response: { status: 401 }, message: 'Unauthorized' };
    const result = errorHandler.classifyError(error);

    expect(result.type).toBe(ErrorType.LLM);
    expect(result.userMessage).toContain('API-ключ');
  });

  it('классифицирует ошибки файловой системы', () => {
    const error = { code: 'ENOENT', path: '/test/file.ts', message: 'Not found' };
    const result = errorHandler.classifyError(error);

    expect(result.type).toBe(ErrorType.FILE_SYSTEM);
    expect(result.userMessage).toContain('Файл не найден');
  });

  it('определяет, нужно ли повторять запрос', () => {
    const networkError = { code: 'ETIMEDOUT', message: 'Timeout' };
    expect(errorHandler.shouldRetry(networkError)).toBe(true);

    const authError = { response: { status: 401 }, message: 'Unauthorized' };
    expect(errorHandler.shouldRetry(authError)).toBe(false);
  });
});
