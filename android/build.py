#!/usr/bin/env python3
"""Build universal APKs with the official SDK tools and JDK; no Gradle dependencies."""
import os
import shutil
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'build'
SDK = Path(os.environ.get('ANDROID_SDK_ROOT') or os.environ['ANDROID_HOME'])
platforms = [p for p in (SDK / 'platforms').iterdir()
             if p.name in ('android-37', 'android-37.0') and (p / 'android.jar').is_file()]
if not platforms:
    raise SystemExit('Install the stable Android 37 platform with sdkmanager first.')
ANDROID = sorted(platforms)[-1] / 'android.jar'
TOOLS = SDK / 'build-tools' / '37.0.0'
if not TOOLS.is_dir():
    raise SystemExit('Install Android SDK Build Tools 37.0.0 first.')
OUT.mkdir(exist_ok=True)

def run(*args):
    subprocess.run([str(x) for x in args], check=True)

def class_jar(directory, destination):
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as z:
        for file in sorted(directory.rglob('*.class')):
            z.write(file, file.relative_to(directory).as_posix())

def compile_apk(name, manifest, sources, resources=None, classpath=None):
    work = OUT / name
    if work.exists():
        shutil.rmtree(work)
    work.mkdir()
    generated = work / 'generated'; generated.mkdir()
    classes = work / 'classes'; classes.mkdir()
    dex = work / 'dex'; dex.mkdir()
    resource_apk = work / 'resources.apk'
    link = [TOOLS / 'aapt2', 'link', '-o', resource_apk, '-I', ANDROID,
            '--manifest', manifest, '--java', generated, '--min-sdk-version', '24',
            '--target-sdk-version', '37']
    if resources:
        compiled = work / 'resources.zip'
        run(TOOLS / 'aapt2', 'compile', '--dir', resources, '-o', compiled)
        link.append(compiled)
    run(*link)
    java = sorted(sources.rglob('*.java')) + sorted(generated.rglob('*.java'))
    compile_classpath = str(ANDROID) + (os.pathsep + str(classpath) if classpath else '')
    javac = ['javac', '--release', '8', '-classpath', compile_classpath, '-encoding', 'UTF-8', '-d', classes]
    run(*javac, *java)
    jar = work / 'classes.jar'; class_jar(classes, jar)
    d8 = [TOOLS / 'd8', '--release', '--min-api', '24', '--lib', ANDROID, '--output', dex]
    if classpath:
        d8.extend(['--classpath', classpath])
    run(*d8, jar)
    combined = work / 'combined.apk'; shutil.copy2(resource_apk, combined)
    with zipfile.ZipFile(combined, 'a', zipfile.ZIP_DEFLATED) as z:
        for file in sorted(dex.glob('*.dex')):
            z.write(file, file.name)
    aligned = OUT / (name + '-unsigned.apk')
    run(TOOLS / 'zipalign', '-f', '-P', '16', '4', combined, aligned)
    return aligned, jar

# Reuse the exact artwork shipped by the web reader.
resources = OUT / 'res'
if resources.exists(): shutil.rmtree(resources)
shutil.copytree(ROOT / 'res', resources)
(resources / 'mipmap-nodpi').mkdir()
(resources / 'drawable-nodpi').mkdir()
shutil.copy2(ROOT.parent / 'dist/library/icons/icon-512.png', resources / 'mipmap-nodpi/ic_launcher.png')
shutil.copy2(ROOT.parent / 'dist/library/icons/maskable-512.png', resources / 'drawable-nodpi/ic_launcher_foreground.png')
app, app_classes = compile_apk('akiva-publishing-1.0.0', ROOT / 'AndroidManifest.xml', ROOT / 'src', resources)
test, _ = compile_apk('akiva-smoke-test', ROOT / 'test/AndroidManifest.xml', ROOT / 'test/src', classpath=app_classes)

# This ephemeral key is only for emulator tests. Deliverable signing happens privately.
key = OUT / 'emulator-test.jks'
if not key.exists():
    run('keytool', '-genkeypair', '-keystore', key, '-storepass', 'androidtest',
        '-keypass', 'androidtest', '-alias', 'emulator', '-keyalg', 'RSA', '-keysize', '2048',
        '-validity', '2', '-dname', 'CN=Akiva Emulator Test')
for unsigned, signed in [(app, OUT / 'akiva-emulator.apk'), (test, OUT / 'akiva-instrumentation.apk')]:
    run(TOOLS / 'apksigner', 'sign', '--ks', key, '--ks-pass', 'pass:androidtest',
        '--ks-key-alias', 'emulator', '--out', signed, unsigned)
    run(TOOLS / 'apksigner', 'verify', '--verbose', signed)
shutil.copy2(TOOLS / 'lib/apksigner.jar', OUT / 'apksigner.jar')
shutil.copy2(TOOLS / 'aapt2', OUT / 'aapt2')
shutil.copy2(TOOLS / 'zipalign', OUT / 'zipalign')
run(TOOLS / 'aapt2', 'dump', 'badging', app)
print('Unsigned universal release APK:', app)
