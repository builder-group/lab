# Lab

Experimental applications and product prototypes maintained by builder.group.

| App                                                 | Stack                                           |
| --------------------------------------------------- | ----------------------------------------------- |
| [Kairos](apps/kairos/README.md)                     | Expo and React Native interval timer for iPhone |
| [LearnLinesFaster](apps/learnlinesfaster/README.md) | React Router web app with Vercel deployment     |
| [MidiMarble](apps/midimarble/README.md)             | React, Three.js, and Rapier browser studio      |

## Development

See [package.json](package.json) for supported Node.js versions. Corepack selects the declared pnpm version.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Run an app with `pnpm --filter <app-name> start:dev`. See its README for platform-specific setup.
