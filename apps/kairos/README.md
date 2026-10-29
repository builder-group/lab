# Kairos

**Kairos** (Greek: καιρός, "the right or opportune moment") is a random interval timer for iPhone.  
You set a minimum and maximum duration, start, and the alarm fires at an unknown moment inside that range.

Kairos is built for moments where exact timing gets in the way: meditation, exercise, study, and party games.

## Concept

Most timers are predictable. Kairos is intentionally not.

- **Set a Range**: Choose minimum and maximum duration
- **Start Once**: Kairos draws a random duration in `[min, max]`
- **Stay Present**: Optional Hide mode replaces countdown with a pulsing indicator
- **Fire**: Alarm sound and haptic when time is up

## Tech

Kairos uses React Native, Expo, TypeScript, and NativeWind. Local native Expo modules under `modules/` provide alarm handling, audio playback, and the duration picker. These modules require a development build rather than Expo Go.

Upgrade NativeWind and `react-native-css` together. The Lightning CSS override in [pnpm-workspace.yaml](../../pnpm-workspace.yaml) prevents a NativeWind CSS compilation error.

## Native builds

The `ios/` and `android/` folders are generated and gitignored. Keep native customizations in Expo config or local modules because a clean prebuild replaces these projects.

After changing Expo SDK versions, regenerate the iOS project and rebuild the development client:

```sh
pnpm --filter @repo/kairos exec expo prebuild --clean --platform ios
pnpm --filter @repo/kairos start:dev:ios:prebuild
```

`pnpm --filter @repo/kairos build` checks TypeScript and exports the iOS JavaScript bundle.
