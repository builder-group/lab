#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${PROJECT_ROOT}"

# Update packages outside Expo's compatibility list
pnpm update --latest \
	'!nativewind' \
	'!react-native-css' \
	'!@expo/*' \
	'!expo' \
	'!expo-*' \
	'!react' \
	'!react-dom' \
	'!react-native' \
	'!react-native-*' \
	'!@react-native-async-storage/async-storage'

pnpm update expo --latest

# Note: EXPO_OFFLINE=1 makes Expo use the installed SDK's package versions
# Online recommendations can include packages still blocked by pnpm's release delay
EXPO_OFFLINE=1 pnpm exec expo install --fix
EXPO_OFFLINE=1 pnpm dlx expo-doctor@latest
