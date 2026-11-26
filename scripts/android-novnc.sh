#!/usr/bin/env bash
set -euo pipefail

export DISPLAY=:98

if ! pgrep -f "Xvfb :98" >/dev/null 2>&1; then
  Xvfb :98 -screen 0 760x1560x24 -ac +extension GLX +render -noreset >/tmp/android-xvfb.log 2>&1 &
  sleep 1
fi

for _ in $(seq 1 60); do
  adb connect 127.0.0.1:5555 >/dev/null 2>&1 || true
  if adb -s 127.0.0.1:5555 get-state 2>/dev/null | grep -q "device"; then
    break
  fi
  sleep 1
done

if ! pgrep -f "x11vnc -display :98" >/dev/null 2>&1; then
  x11vnc -display :98 -forever -shared -nopw -listen 127.0.0.1 -rfbport 5900 -noxdamage >/tmp/android-x11vnc.log 2>&1 &
  sleep 1
fi

if ! pgrep -f "websockify.*6080" >/dev/null 2>&1; then
  websockify --web=/usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900 >/tmp/android-novnc.log 2>&1 &
  sleep 1
fi

while true; do
  adb connect 127.0.0.1:5555 >/dev/null 2>&1 || true
  scrcpy -s 127.0.0.1:5555 --window-borderless --window-x=0 --window-y=0 --window-width=760 --window-height=1560 --max-fps=30 --video-codec=h264 --no-audio >/tmp/android-scrcpy.log 2>&1 || true
  sleep 2
done
