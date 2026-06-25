module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  
  // Ключевое исправление: moduleNameMapper подменяет модуль 'vscode' на наш мок
  // Это решает проблему "Maximum call stack size exceeded"
  moduleNameMapper: {
    '^vscode$': '<rootDir>/tests/__mocks__/vscode.ts'
  },
  
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts'
  ],
  coverageDirectory: 'coverage',
  verbose: true,
  testTimeout: 10000,
  
  // Игнорируем предупреждения о нестабильных API
  silent: false
};
