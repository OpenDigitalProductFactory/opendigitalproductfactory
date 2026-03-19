import type { Config } from "jest";

const config: Config = {
  preset: "jest-expo",
  setupFilesAfterSetup: ["./jest.setup.ts"],
  transformIgnorePatterns: [
    "node_modules/(?!(?:.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|native-base|react-native-svg|react-native-sse|react-native-mmkv|nativewind))"
  ],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1"
  },
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts"
  ]
};

export default config;
