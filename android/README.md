# Akiva Publishing for Android

A Google Play Android App Bundle and a universal APK for Android 7.0 (API 24) and later, built against and targeting Android 17 (API 37). No native libraries or CPU-specific splits are used. Phones, tablets, foldables, split-screen, desktop windows, and Android-enabled Chromebooks share the same package.

The app opens the live Akiva Publishing reader at https://akiva-publishing-kisvei-rav-tzadok.netlify.app/library/. Content updates come from that website. Hebrew/English interlinear reading, Sefaria citations, and connections use the existing reader. Keep Android System WebView updated. Connect on first launch, then save books or packs from the library for offline reading. Previously cached sources remain available offline; new Sefaria connections need a connection.

Window resizing and rotation preserve the reading page. Large windows show a source sidebar; smaller windows use the reader's source drawer. Touch, keyboard, mouse, and text selection are supported. Ctrl+F finds text, Ctrl+R refreshes, and Alt+Left goes back. The menu shares the current reading link, opens it in a browser, or displays the published privacy policy. Word/ZIP downloads and generated offline exports use Android's file picker without storage permissions. External Sefaria pages open in a browser.

## Build and verify

Install JDK 17, the stable Android SDK platform 37 (SDK directory `android-37` or `android-37.0`), and Build Tools 37.0.0. Set `ANDROID_HOME` or `ANDROID_SDK_ROOT`, then run `python3 android/build.py`. The unsigned releases are `android/build/akiva-publishing-1.0.1-unsigned.apk` and `android/build/akiva-publishing-1.0.1-unsigned.aab`. The build downloads official Google bundletool 1.18.3 and verifies its pinned SHA-256. The generated emulator key and emulator APKs are exclusively for testing, not distribution.

The GitHub workflow validates the App Bundle, generates a universal APK from that bundle, installs it in an Android emulator, checks 400×800, 800×1280, 1280×800, and 800×360 windows, validates Hebrew/English text and source connections, checks reading state after resize, and reloads a cached chapter with network loads blocked. Test screenshots and logs are included in the build artifact. It does not replace physical-device testing.

Release signing takes place privately after downloading the unsigned artifact. Never commit the release signing key. Keep a private backup of that key and its password; future APK updates must use the same signer and a higher `versionCode`. Align before signing, then verify:

```sh
apksigner sign --ks /private/akiva-release.p12 --ks-key-alias akiva-publishing --out Akiva-Publishing-1.0.1.apk android/build/akiva-publishing-1.0.1-unsigned.apk
apksigner verify --verbose --print-certs Akiva-Publishing-1.0.1.apk
```

The APK is an Android installer. A Windows or macOS laptop needs an Android runtime to install it; the existing website can also be installed as a browser app on those systems. Chromebook APK sideloading depends on the device's Android and installation settings. The App Bundle is the upload format for Google Play. Publication requires the owner’s verified Play Console account, Play App Signing setup, completed store declarations, and any testing requirements imposed on that account.

## Google Play signing

Sign the validated AAB privately with `jarsigner`, using the existing release key. An AAB upload signature is distinct from the distribution signer chosen during Play App Signing enrollment. To allow existing sideloaded APK installations to update directly from Google Play, preserve the original APK signing certificate through Google’s supported import process. Do not upload an unencrypted private key or signing backup.

```sh
jarsigner -keystore /private/akiva-release.p12 -storepass:file /private/signing-password.txt -signedjar Akiva-Publishing-1.0.1.aab android/build/akiva-publishing-1.0.1-unsigned.aab akiva-publishing
jarsigner -verify Akiva-Publishing-1.0.1.aab
java -jar android/build/bundletool-1.18.3.jar validate --bundle=Akiva-Publishing-1.0.1.aab
```
