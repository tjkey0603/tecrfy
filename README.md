# Profit Tracker - Android app (fully offline)

Built from your latest Replit source (src/App.tsx), not the old dist build.
Everything is bundled in the app: code, fonts, data storage. It never needs internet.

## Get the APK
1. Make a NEW GitHub repo. Upload the CONTENTS of this folder to the repo root
   (package.json must be at the top level, and include the hidden .github folder).
2. Actions tab -> Build APK -> wait for the green tick (~6 min).
3. Open the run -> Artifacts -> profit-tracker-apk -> download, unzip -> app-debug.apk.
4. Copy to phone, tap, allow "install unknown apps".

## Notes
- Data is saved on the phone. Use the ... menu -> save to file to back up
  (opens the Android share sheet: save to Drive/Files/WhatsApp etc.), and Import to restore.
- Uninstalling the app or clearing its storage deletes the data - back up first.
