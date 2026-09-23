/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': ['babel-jest', { configFile: './babel.config.jest.js' }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(css|less|scss|sass)$': '<rootDir>/__mocks__/styleMock.js',
  },
  testMatch: ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],
  // Playwright e2e suites live in ./e2e and must never run inside Jest.
  testPathIgnorePatterns: ['/node_modules/', '/e2e/'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // #536 — frontend coverage is enforced. Thresholds sit just below the
  // measured all-files numbers so small fluctuations don't flake the build,
  // but any meaningful coverage regression fails CI.
  collectCoverage: true,
  coverageThreshold: {
    global: {
      statements: 75,
      branches: 72,
      functions: 77,
      lines: 76,
    },
  },
};

module.exports = config;
