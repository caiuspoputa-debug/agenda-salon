"""Compile the bundled official AOSP JSON sources for native host-side tests.

Android SDK android.jar contains API stubs, so these public AOSP classes provide
real parsing/serialization. No production Android package, device or network is
used. Sources retain their Apache 2.0 notices.
"""
from pathlib import Path
import subprocess


def json_runtime(base):
    support = Path(base) / 'tests/native-support'
    destination = Path(base).parent / 'salon-native-test-runtime/classes'
    sources = sorted(support.rglob('*.java'))
    assert sources, 'Bundled official AOSP JSON sources are required'
    target = destination / 'org/json/JSONObject.class'
    if not target.exists() or any(p.stat().st_mtime > target.stat().st_mtime for p in sources):
        destination.mkdir(parents=True, exist_ok=True)
        javac = Path('C:/Program Files/Android/Android Studio/jbr/bin/javac.exe')
        subprocess.run([str(javac), '-encoding', 'UTF-8', '-d', str(destination),
                        *map(str, sources)], check=True, timeout=30)
    return destination
