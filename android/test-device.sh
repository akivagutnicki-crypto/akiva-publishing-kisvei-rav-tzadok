#!/usr/bin/env bash
set -euo pipefail
task_sdk_root="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
task_platform_tools="$task_sdk_root/platform-tools"
export PATH="$task_platform_tools:$task_sdk_root/emulator:$PATH"
task_build="$(cd "$(dirname "$0")" && pwd)/build"
adb wait-for-device
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0
adb install -r "$task_build/akiva-emulator.apk"
adb install -r "$task_build/akiva-instrumentation.apk"
adb logcat -c
set +e
adb shell am instrument -w org.akivapublishing.reader.test/org.akivapublishing.reader.SmokeInstrumentation > "$task_build/smoke-results.txt" 2>&1
task_status=$?
set -e
cat "$task_build/smoke-results.txt"
adb pull /sdcard/Android/data/org.akivapublishing.reader/files/smoke-screenshots "$task_build/screenshots" || true
adb logcat -d -s AkivaSmoke chromium AndroidRuntime > "$task_build/device-log.txt"
adb shell wm size reset
adb shell wm density reset
python3 - "$task_build/smoke-results.txt" "$task_status" <<'PY'
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text()
if sys.argv[2] != '0' or 'akiva.status=passed' not in text:
    raise SystemExit('Android adaptive smoke tests failed; see smoke-results.txt and device-log.txt.')
PY
