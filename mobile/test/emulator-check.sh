#!/usr/bin/env bash
# Installs the APK on the running emulator, opens Mercify, and saves what it saw into $2:
# screen.txt (every piece of text on screen), screen.png, logcat.txt (errors and the app's own
# log), and the same again after granting Spotify access. Used by the Android workflow.
set -u
apk="$1"
out="$2"
pkg=com.kainmercer.mercify
mkdir -p "$out"

snap() { # name
	adb exec-out screencap -p > "$out/$1.png"
	adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1
	adb shell cat /sdcard/ui.xml | grep -o 'text="[^"]*"' | sed 's/^text="//; s/"$//' | grep -v '^$' > "$out/$1.txt"
}

adb install -r "$apk" > "$out/install.txt" 2>&1
adb shell pm grant "$pkg" android.permission.POST_NOTIFICATIONS 2>/dev/null # as if "Allow" was tapped
adb logcat -c
adb shell am start -W -n "$pkg/.MainActivity" > "$out/start.txt" 2>&1
sleep 25
snap screen

# Grant notification access (what "Allow" leads to), reopen, and look again.
adb shell cmd notification allow_listener "$pkg/$pkg.SpotifyListenerService" >> "$out/start.txt" 2>&1
adb shell am force-stop "$pkg"
adb shell am start -W -n "$pkg/.MainActivity" >> "$out/start.txt" 2>&1
sleep 20
snap screen-after-access

adb logcat -d -v time '*:W' ReactNativeJS:V ReactNative:V > "$out/logcat.txt"
adb shell pidof "$pkg" > "$out/pid.txt" 2>&1 || echo "not running (crashed?)" > "$out/pid.txt"
echo "--- screen ---"; cat "$out/screen.txt"
echo "--- after access ---"; cat "$out/screen-after-access.txt"
exit 0
