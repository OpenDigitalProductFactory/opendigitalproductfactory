# DPF Mobile — iOS & Android Companion App

Native companion app for the Open Digital Product Factory platform.

## Tech Stack

- React Native + Expo SDK 53+ (managed workflow)
- TypeScript (strict mode)
- Expo Router (file-based navigation)
- Zustand (state management)
- NativeWind v4 (Tailwind CSS for React Native)
- expo-sqlite + react-native-mmkv (offline caching)
- Jest + React Native Testing Library (unit/component tests)
- Maestro (E2E tests)

## Development

### Prerequisites

- Node.js 20+
- pnpm 10+
- Expo CLI: `npm install -g expo-cli`
- EAS CLI: `npm install -g eas-cli`

### Setup

```bash
# From monorepo root
pnpm install

# Start Expo dev server
cd apps/mobile
npx expo start
```

### Running Tests

```bash
# Unit + component tests
cd apps/mobile
pnpm test

# With coverage
pnpm test:ci

# E2E tests (requires simulator + Maestro CLI)
maestro test e2e/flows/
```

### Building

```bash
# Development build
eas build --profile development --platform all

# Preview build (internal distribution)
eas build --profile preview --platform all

# Production build
eas build --profile production --platform all

# Submit to app stores
eas submit --platform all
```

## Project Structure

```
apps/mobile/
├── app/                    # Expo Router screens
│   ├── _layout.tsx         # Root layout (auth gate)
│   ├── login.tsx           # Login screen
│   └── (tabs)/             # Tab navigation
│       ├── index.tsx       # Home/Dashboard
│       ├── ops/            # Epics + Backlog
│       ├── portfolio/      # Portfolio tree
│       ├── customers/      # Customer management
│       └── more/           # Compliance, approvals, notifications, profile
├── src/
│   ├── components/         # Shared components
│   │   └── ui/             # Design system primitives
│   ├── features/           # Feature modules (store + hooks per feature)
│   ├── stores/             # Cross-cutting stores (offline queue)
│   ├── repositories/       # Storage interfaces (cache, secure store)
│   ├── hooks/              # Shared hooks
│   ├── lib/                # Theme, constants, API client config
│   └── mocks/              # MSW handlers for testing
├── dynamic/                # Dynamic form + view renderer
│   ├── fields/             # Field type components
│   └── widgets/            # Widget type components
└── e2e/flows/              # Maestro E2E test flows
```

## Shared Packages

The mobile app uses shared packages from the monorepo:

- `@dpf/types` — Entity types, API request/response shapes, dynamic content schemas
- `@dpf/validators` — Zod validation schemas
- `@dpf/api-client` — Typed REST API client

## API

The mobile app communicates with the platform via REST API at `/api/v1/*`. Authentication uses JWT (stored in Secure Storage with biometric protection). See the spec at `docs/superpowers/specs/2026-03-19-mobile-companion-app-design.md`.
