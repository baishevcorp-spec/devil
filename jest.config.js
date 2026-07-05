module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],

  // Объединённый moduleNameMapper (оба мока в tests/__mocks__/)
  moduleNameMapper: {
    '^vscode$': '<rootDir>/tests/__mocks__/vscode.js',
    '^@xenova/transformers$': '<rootDir>/tests/__mocks__/@xenova/transformers.js',
  },

  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  coverageDirectory: 'coverage',
  verbose: true,
  testTimeout: 10000,
  silent: false,
};
