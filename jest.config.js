module.exports = {
        preset: 'ts-jest',
        testEnvironment: 'node',
        testMatch: ['**/tests/**/*.test.ts'],
        moduleNameMapper: {
                '^@/(.*)$': '<rootDir>/$1',
                '^obsidian$': '<rootDir>/tests/__mocks__/obsidian.ts'
        }
};
