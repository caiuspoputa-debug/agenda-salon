"""Production native updater -> official Android JSON -> actual callback JS.

Android Activity/PackageManager are service adapters only. HTTPS metadata reads
are real and read-only; install() is never called. No Android device is claimed.
Requires the official AOSP JSON audit classes prepared by the review agent.
"""
from pathlib import Path
import json
import re
import subprocess
import sys
import tempfile

sys.stdout.reconfigure(encoding='utf-8')

base = Path(__file__).resolve().parents[1]
source = base / 'app/src/main/java/ro/salon/agenda/test'
java = Path('C:/Program Files/Android/Android Studio/jbr/bin')
from native_update_test_support import json_runtime
json_classes = json_runtime(base)
assert (json_classes / 'org/json/JSONObject.class').exists(), 'Official AOSP JSON audit classes missing'
main = (source / 'MainActivity.java').read_text(encoding='utf-8')
callback = re.search(r'    private void deliverAppUpdateResult\([^\n]+\) \{\n.*?\n    \}', main, re.S)
assert callback, 'Actual native callback method missing'

stubs = {
'android/app/Activity.java': '''package android.app;public class Activity {
public final android.content.pm.PackageManager pm=new android.content.pm.PackageManager();
public final java.util.concurrent.ExecutorService ui=java.util.concurrent.Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"fixture-android-ui");t.setDaemon(true);return t;});
public android.content.pm.PackageManager getPackageManager(){return pm;}public String getPackageName(){return "ro.salon.agenda.test";}
public void runOnUiThread(Runnable r){ui.execute(r);}public void startActivity(android.content.Intent i){throw new AssertionError("Installer must never be opened by a metadata check");}
}''',
'android/content/Intent.java': '''package android.content;public class Intent {
public static final String ACTION_VIEW="VIEW";public static final int FLAG_GRANT_READ_URI_PERMISSION=1;
public Intent(String a){}public Intent(String a,android.net.Uri uri){}public Intent setDataAndType(android.net.Uri uri,String mime){return this;}
public void setClipData(ClipData data){}public Intent addFlags(int flags){return this;}
}''',
'android/content/ClipData.java': '''package android.content;public class ClipData {public static ClipData newRawUri(String name,android.net.Uri uri){return new ClipData();}}''',
'android/content/pm/PackageManager.java': '''package android.content.pm;public class PackageManager {
public static final int GET_SIGNING_CERTIFICATES=1,GET_SIGNATURES=2;public final PackageInfo installed=new PackageInfo();
public PackageInfo getPackageInfo(String name,int flags){return installed;}public PackageInfo getPackageArchiveInfo(String name,int flags){throw new AssertionError("No APK installation in check test");}
public boolean canRequestPackageInstalls(){throw new AssertionError("No install permission request during metadata check");}
}''',
'android/content/pm/PackageInfo.java': '''package android.content.pm;public class PackageInfo {
public String packageName="ro.salon.agenda.test",versionName="1.0.19";public int versionCode=30;
public ApplicationInfo applicationInfo=new ApplicationInfo();public Signature[] signatures={new Signature()};public SigningInfo signingInfo=new SigningInfo();
public long getLongVersionCode(){return versionCode;}
}''',
'android/content/pm/ApplicationInfo.java': 'package android.content.pm;public class ApplicationInfo {public int minSdkVersion=26;}',
'android/content/pm/SigningInfo.java': 'package android.content.pm;public class SigningInfo {public Signature[] getApkContentsSigners(){return new Signature[]{new Signature()};}}',
'android/content/pm/Signature.java': 'package android.content.pm;public class Signature {public byte[] toByteArray(){return new byte[]{1,2,3};}}',
'android/net/Uri.java': 'package android.net;public class Uri {public static Uri parse(String raw){return new Uri();}}',
'android/os/Build.java': 'package android.os;public class Build {public static class VERSION {public static int SDK_INT=36;}}',
'android/os/SystemClock.java': 'package android.os;public class SystemClock {public static long elapsedRealtime(){return System.nanoTime()/1000000;}}',
'android/provider/Settings.java': 'package android.provider;public class Settings {public static final String ACTION_MANAGE_UNKNOWN_APP_SOURCES="INSTALL_PERMISSION";}',
'ro/salon/agenda/test/UpdateApkProvider.java': '''package ro.salon.agenda.test;final class UpdateApkProvider {
static final String MIME="application/vnd.android.package-archive";static java.io.File directory(android.app.Activity a){throw new AssertionError("No APK download during metadata check");}
static android.net.Uri uri(android.app.Activity a,String digest){throw new AssertionError("No installer URI during metadata check");}}
''',
'ro/salon/agenda/test/NativeUpdateNetworkTest.java': '''package ro.salon.agenda.test;
import org.json.JSONObject;import java.util.concurrent.*;import java.net.*;import java.io.*;
public final class NativeUpdateNetworkTest {
static final class Probe {
volatile boolean destroyed;boolean trusted=true;final CountDownLatch finished=new CountDownLatch(1);String script,thread;
final FakeWebView webView=new FakeWebView();boolean trustedPage(){return trusted;}
final class FakeWebView {void evaluateJavascript(String value,Object ignored){script=value;thread=Thread.currentThread().getName();finished.countDown();}}
''' + callback.group(0) + '''
}
public static void main(String[] args)throws Exception {
System.setOut(new java.io.PrintStream(System.out,true,"UTF-8"));
String mode=args[0];int installed=mode.equals("current")?Integer.MAX_VALUE:1;
if(mode.equals("error"))URL.setURLStreamHandlerFactory(protocol->"https".equals(protocol)?new URLStreamHandler(){protected URLConnection openConnection(URL u){return new HttpURLConnection(u){public void connect()throws IOException{throw new IOException("fixture network unavailable");}public void disconnect(){}public boolean usingProxy(){return false;}public int getResponseCode()throws IOException{throw new IOException("fixture network unavailable");}};}}:null);
android.app.Activity activity=new android.app.Activity();activity.pm.installed.versionCode=installed;
Probe probe=new Probe();AppUpdater updater=new AppUpdater(activity,probe::deliverAppUpdateResult);long start=System.nanoTime();
try {updater.check("app-update-0-1");if(!probe.finished.await(72,TimeUnit.SECONDS))throw new AssertionError("Native updater failed to deliver any callback within 72 seconds");
if(!"fixture-android-ui".equals(probe.thread))throw new AssertionError("Callback did not return through Android UI adapter");
System.out.println(new JSONObject().put("mode",mode).put("installedCode",installed).put("elapsedMs",(System.nanoTime()-start)/1000000).put("script",probe.script));
}finally{updater.destroy();activity.ui.shutdownNow();}
}
}
'''
}

with tempfile.TemporaryDirectory(prefix='salon-native-update-network-') as directory:
    root = Path(directory)
    for name, content in stubs.items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding='utf-8')
    classes = root / 'classes'
    sources = [str(path) for path in root.rglob('*.java')] + [str(source / name) for name in ('AppUpdater.java', 'UpdatePolicy.java', 'UpdateResultMailbox.java')]
    subprocess.run([str(java / 'javac.exe'), '-encoding', 'UTF-8', '-cp', str(json_classes), '-d', str(classes), *sources], check=True, timeout=30)
    results = []
    for mode in ['available', 'current', 'error']:
        completed = subprocess.run([str(java / 'java.exe'), '-cp', str(classes) + ';' + str(json_classes), 'ro.salon.agenda.test.NativeUpdateNetworkTest', mode], check=True, text=True, encoding='utf-8', capture_output=True, timeout=77)
        result = json.loads(completed.stdout)
        # Execute the precise MainActivity-generated callback against production
        # updates.js to ensure a native response clears its pending JS state.
        script = r'''
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const fixture=JSON.parse(fs.readFileSync(0,'utf8'));const {create}=require(process.argv[1]);
const win={navigator:{onLine:true},addEventListener(){},removeEventListener(){}};
const bridge={appUpdateInfo:()=>JSON.stringify({versionCode:fixture.installedCode,versionName:'1.0.19'}),checkAppUpdate:id=>assert.equal(id,'app-update-0-1'),installAppUpdate:()=>{throw Error('No install during check');}};
const manager=create({window:win,Android:bridge,now:()=>0,setTimeout:()=>1,clearTimeout:()=>{}});manager.start();manager.check();assert.equal(manager.getStatus().busy,true);
vm.runInNewContext(fixture.script,{window:win});const status=manager.getStatus();assert.equal(status.busy,false);assert.equal(status.status,fixture.mode);manager.destroy();
console.log(JSON.stringify({mode:fixture.mode,elapsedMs:fixture.elapsedMs,status:status.status,pendingCleared:!status.busy,message:status.message,version:status.available?.versionName}));
'''
        checked = subprocess.run(['C:/Program Files/nodejs/node.exe', '--max-old-space-size=128', '-e', script, str(base / 'app/src/main/assets/updates.js')], input=json.dumps(result), text=True, encoding='utf-8', capture_output=True, timeout=10)
        if checked.returncode:
            print('Native fixture:', json.dumps(result, ensure_ascii=False), file=sys.stderr)
            print(checked.stderr, file=sys.stderr)
            checked.check_returncode()
        results.append(json.loads(checked.stdout))
        print('PASS actual AppUpdater.check + Android16 JSON + MainActivity callback + JS pending state: ' + checked.stdout.strip(), flush=True)
    print('No APK download, installation, credentials or business/cloud data accessed.', flush=True)
