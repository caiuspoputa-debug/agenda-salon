"""Execute actual MainActivity updater bridge methods with production updater.

Verifies exact legacy asset trust, synchronous process-only mailbox lookup and
explicit guard errors. Salon has no HTTPS origin migration; this test prevents
introducing one merely because the Frizerie shell needed it.
"""
from pathlib import Path
import ast
import re
import subprocess
import sys
import tempfile
from native_update_test_support import json_runtime

sys.stdout.reconfigure(encoding='utf-8')
base = Path(__file__).resolve().parents[1]
source = base / 'app/src/main/java/ro/caiuspoputa/agendasalon'
java = Path('C:/Program Files/Android/Android Studio/jbr/bin')
json_classes = json_runtime(base)
main = (source / 'MainActivity.java').read_text(encoding='utf-8')
assert 'private static final String HOME = "file:///android_asset/index.html";' in main
assert 'originMigrationPending' not in main, 'Salon requires no new origin migration'

def method(name, indentation):
    pattern = re.compile(r'^' + ' ' * indentation + r'[^\n]*\b' + name + r'\([^\n]*\) \{\n.*?^' + ' ' * indentation + r'\}', re.M | re.S)
    match = pattern.search(main)
    assert match, 'Actual MainActivity method missing: ' + name
    return match.group(0)

callback = re.search(r'    private void deliverAppUpdateResult\([^\n]+\) \{\n.*?\n    \}', main, re.S)
fixture = base / 'tests/native-update-network.py'
tree = ast.parse(fixture.read_text(encoding='utf-8'))
assignment = next(n for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'stubs' for t in n.targets))
namespace = {'callback': callback}
exec(compile(ast.Module(body=[assignment], type_ignores=[]), str(fixture), 'exec'), namespace)
stubs = namespace['stubs']
del stubs['ro/caiuspoputa/agendasalon/NativeUpdateNetworkTest.java']
stubs['android/net/Uri.java'] = '''package android.net;public class Uri {
private final String raw;private Uri(String raw){this.raw=raw;}
public static Uri parse(String raw){return new Uri(raw);}@Override public String toString(){return raw;}}
'''
bridge_methods = '\n'.join(method(name, 8) for name in ('appUpdateInfo', 'checkAppUpdate', 'appUpdateResult', 'installAppUpdate'))
stubs['ro/caiuspoputa/agendasalon/NativeUpdateBridgeTest.java'] = '''package ro.caiuspoputa.agendasalon;
import android.net.Uri;import java.util.*;import java.util.concurrent.*;import java.net.*;import java.io.*;import org.json.JSONObject;
@interface JavascriptInterface {}
public final class NativeUpdateBridgeTest {
static int checks;static void check(boolean value,String message){checks++;if(!value)throw new AssertionError(message);}
static final class Probe extends android.app.Activity {
private static final String HOME="file:///android_asset/index.html";
boolean destroyed,dropUi;int webViewReads;String url=HOME;
final List<Runnable> pending=new ArrayList<>();final FakeWebView webView=new FakeWebView();
final AppUpdater appUpdater=new AppUpdater(this,(id,value)->{});
final class FakeWebView {String getUrl(){webViewReads++;return url;}}
@Override public void runOnUiThread(Runnable value){if(dropUi)pending.add(value);else value.run();}
''' + method('isHome', 4) + '\n' + method('trustedPage', 4) + '''
public final class AndroidBridge {
''' + bridge_methods + '''
}
}
static JSONObject envelope(Probe probe,String id)throws Exception{return new JSONObject(probe.new AndroidBridge().appUpdateResult(id));}
public static void main(String[] args)throws Exception {
 URL.setURLStreamHandlerFactory(protocol->"https".equals(protocol)?new URLStreamHandler(){protected URLConnection openConnection(URL url){throw new AssertionError("Untrusted bridge must never request network");}}:null);
 Probe probe=new Probe();Probe.AndroidBridge bridge=probe.new AndroidBridge();
 try {
  check(Probe.isHome(Uri.parse("file:///android_asset/index.html")),"exact packaged asset accepted");
  for(String url:new String[]{"file:///android_asset/index.html?x=1","file:///android_asset/index.html#x","file://remote/android_asset/index.html","file:///android_asset/other.html","file:///sdcard/index.html","https://example.com/index.html","https://caiuspoputa-debug.github.io/agenda-salon/index.html","about:blank",""}){
   check(!Probe.isHome(Uri.parse(url)),"only exact legacy home is trusted: "+url);
   probe.url=url;String id="denied-"+checks;bridge.checkAppUpdate(id);JSONObject rejected=envelope(probe,id);check("terminal".equals(rejected.getString("stage")),"guard rejection terminal");check("error".equals(rejected.getJSONObject("result").getString("status")),"guard rejection retained instead of silent timeout");
   id="install-denied-"+checks;bridge.installAppUpdate(id);check("error".equals(envelope(probe,id).getJSONObject("result").getString("status")),"installation also requires exact trusted page");
  }
  probe.url="file:///android_asset/index.html";probe.dropUi=true;bridge.checkAppUpdate("queued-no-ui");int before=probe.webViewReads;
  check("queued".equals(envelope(probe,"queued-no-ui").getString("stage")),"queue evidence visible before UI scheduling");
  check(bridge.appUpdateResult("unknown").isEmpty(),"unknown getter returns empty");check(bridge.appUpdateResult("bad/id").isEmpty(),"invalid getter returns empty");
  probe.appUpdater.rejectResult("queued-no-ui","Test result");check("error".equals(envelope(probe,"queued-no-ui").getJSONObject("result").getString("status")),"retained result survives dropped UI");
  check(probe.webViewReads==before,"mailbox getter never touches WebView or trustedPage");
  probe.destroyed=true;check(bridge.appUpdateResult("queued-no-ui").isEmpty(),"destroyed bridge returns empty");check("{}".equals(bridge.appUpdateInfo()),"destroyed bridge info is empty");
 } finally {probe.appUpdater.destroy();probe.ui.shutdownNow();}
 System.out.println("PASS actual MainActivity updater bridge: "+checks+" assertions; exact legacy origin, dropped UI, memory getter, explicit rejection, no migration/network/device");
}
}
'''
with tempfile.TemporaryDirectory(prefix='salon-native-update-bridge-') as directory:
    root = Path(directory)
    for name, content in stubs.items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding='utf-8')
    classes = root / 'classes'
    sources = [str(p) for p in root.rglob('*.java')] + [str(source / name) for name in ('AppUpdater.java', 'UpdatePolicy.java', 'UpdateResultMailbox.java')]
    subprocess.run([str(java / 'javac.exe'), '-encoding', 'UTF-8', '-cp', str(json_classes), '-d', str(classes), *sources], check=True, timeout=30)
    subprocess.run([str(java / 'java.exe'), '-cp', str(classes) + ';' + str(json_classes), 'ro.caiuspoputa.agendasalon.NativeUpdateBridgeTest'], check=True, timeout=10)
