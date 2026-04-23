/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["./jest.setup.ts"],
  transformIgnorePatterns: [
    "node_modules/(?!(?:.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|native-base|react-native-svg|react-native-sse|react-native-mmkv|nativewind|zustand))"
  ],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^react$": "<rootDir>/../../node_modules/react",
    "^react/jsx-runtime$": "<rootDir>/../../node_modules/react/jsx-runtime",
    "^react/jsx-dev-runtime$": "<rootDir>/../../node_modules/react/jsx-dev-runtime",
    "^react-test-renderer$": "<rootDir>/../../node_modules/react-test-renderer",
    "^expo/src/winter$": "<rootDir>/__mocks__/expo-winter-index.js",
    "^expo/src/winter/(.*)$": "<rootDir>/__mocks__/expo-winter.js",
    "^expo/build/winter$": "<rootDir>/__mocks__/expo-winter-index.js",
    "^expo/build/winter/(.*)$": "<rootDir>/__mocks__/expo-winter.js"
  },
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts"
  ],
  testPathIgnorePatterns: [
    "/node_modules/",
    "__tests__/utils/"
  ]
};
