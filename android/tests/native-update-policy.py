"""Run production pure-Java update allowlist/integrity/freshness policy tests."""
from pathlib import Path
import subprocess
import tempfile

base = Path(__file__).resolve().parents[1]
java = Path('C:/Program Files/Android/Android Studio/jbr/bin')
with tempfile.TemporaryDirectory(prefix='salon-native-update-policy-') as directory:
    sources = [base / 'tests/NativeUpdatePolicyTest.java',
               base / 'app/src/main/java/ro/salon/agenda/test/UpdatePolicy.java']
    subprocess.run([str(java / 'javac.exe'), '-encoding', 'UTF-8', '-d', directory,
                    *map(str, sources)], check=True, timeout=30)
    subprocess.run([str(java / 'java.exe'), '-cp', directory,
                    'ro.salon.agenda.test.NativeUpdatePolicyTest'], check=True, timeout=10)
