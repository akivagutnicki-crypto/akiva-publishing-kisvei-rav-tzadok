#!/usr/bin/env bash
# Configure existing Android release/upload signing credentials securely.
# The keystore and passwords are read on your computer, never committed.
set -euo pipefail

REPO="akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok"
if ! command -v gh >/dev/null 2>&1; then
  echo "Install GitHub CLI first: https://cli.github.com/"
  exit 1
fi
if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  echo "Run 'gh auth login' to sign in to GitHub, then run this script again."
  exit 1
fi
echo "Akiva Publishing — configure your EXISTING Android release/upload key."
echo "Your signing key must match the existing Android or Google Play upload identity."
echo "Do not use a new key to update an already-published application."
printf 'Path to your existing .jks/.keystore/.p12 signing file: '
IFS= read -r KEYSTORE
if [[ "$KEYSTORE" == "~/"* ]]; then KEYSTORE="$HOME/${KEYSTORE:2}"; fi
if [[ ! -f "$KEYSTORE" || ! -r "$KEYSTORE" ]]; then
  echo "Keystore file cannot be read. No GitHub secrets were changed."
  exit 1
fi
printf 'Key alias used for Android signing: '
IFS= read -r KEY_ALIAS
if [[ -z "$KEY_ALIAS" ]]; then
  echo "A nonempty key alias is required. No GitHub secrets were changed."
  exit 1
fi
read -r -s -p 'Keystore password (not displayed): ' STORE_PASS
printf '\n'
if [[ -z "$STORE_PASS" ]]; then
  echo "A nonempty keystore password is required. No GitHub secrets were changed."
  exit 1
fi
read -r -s -p 'Key password (Enter if same as keystore password): ' KEY_PASS
printf '\n'
KEY_PASS="${KEY_PASS:-$STORE_PASS}"
# Check the existing keystore and alias locally before sending secrets.
if command -v keytool >/dev/null 2>&1; then
  if ! AKIVA_LOCAL_STORE_PASS="$STORE_PASS" keytool -list -keystore "$KEYSTORE" -storepass:env AKIVA_LOCAL_STORE_PASS -alias "$KEY_ALIAS" >/dev/null 2>&1; then
    echo "Keytool could not read the alias using that keystore/password. No GitHub secrets were changed."
    exit 1
  fi
fi

# GitHub CLI encrypts repository Actions secrets before storing them.
# Streaming through stdin avoids placing the binary key or passwords on command lines.
base64 < "$KEYSTORE" | tr -d '\r\n' | gh secret set AKIVA_ANDROID_KEYSTORE_BASE64 --repo "$REPO"
printf '%s' "$STORE_PASS" | gh secret set AKIVA_ANDROID_KEYSTORE_PASSWORD --repo "$REPO"
printf '%s' "$KEY_ALIAS" | gh secret set AKIVA_ANDROID_KEY_ALIAS --repo "$REPO"
printf '%s' "$KEY_PASS" | gh secret set AKIVA_ANDROID_KEY_PASSWORD --repo "$REPO"
unset STORE_PASS KEY_PASS

echo "Four encrypted GitHub Actions secrets have been configured."
echo "Starting the Android release build from GitHub Actions..."
gh workflow run android-apk.yml --repo "$REPO" --ref main
echo "Build status: https://github.com/$REPO/actions/workflows/android-apk.yml"
echo "When the workflow passes, signed APK/AAB assets will appear at:"
echo "https://github.com/$REPO/releases/tag/android-v1.0.5"
