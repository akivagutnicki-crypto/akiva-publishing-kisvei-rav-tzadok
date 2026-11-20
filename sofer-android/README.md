# SoferStudio AI for Android

The TWA uses the live standalone app under /sofer-studio/ on the existing Cloudflare host. The app requests one SoferStudio key and never ships provider credentials.

Use Node.js, JDK 17, Android SDK, and Bubblewrap. Run bash build-aab.sh with the signing keystore for ai.soferstudio.app. Keep that keystore outside source control. Set SOFER_ANDROID_SHA256 on the Cloudflare Worker to the colon-delimited SHA-256 certificate fingerprint from Google Play App Signing. The Worker serves the corresponding Digital Asset Links statement at the origin root. Check the association before uploading the signed bundle to an authorized Play Console track.

For a bundled Capacitor wrapper, build the standalone app and copy its generated contents to www/, then add and synchronize Android with Capacitor. The production Worker currently allows the published application origins. Configure the exact Capacitor origin in OCR_ALLOWED_ORIGINS before using the bundled wrapper with the API.
