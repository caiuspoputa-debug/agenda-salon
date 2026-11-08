"""Actual updater with Android service adapters: explicit browser handoff, metadata-only network.

No accounts, Android device, external browser or APK download is used.
"""
from pathlib import Path
import ast, re, subprocess, tempfile
from native_update_test_support import json_runtime
base=Path(__file__).resolve().parents[1]
source=base/'app/src/main/java/ro/caiuspoputa/agendasalon'
java=Path('C:/Program Files/Android/Android Studio/jbr/bin')
json_classes=json_runtime(base)
fixture=base/'tests/native-update-network.py'
tree=ast.parse(fixture.read_text(encoding='utf-8'))
assignment=next(n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='stubs' for t in n.targets))
callback=re.search(r'    private void deliverAppUpdateResult\([^\n]+\) \{\n.*?\n    \}',(source/'MainActivity.java').read_text(encoding='utf-8'),re.S)
namespace={'callback':callback}
exec(compile(ast.Module(body=[assignment],type_ignores=[]),str(fixture),'exec'),namespace)
stubs=namespace['stubs']
for name in ['ro/caiuspoputa/agendasalon/NativeUpdateNetworkTest.java','ro/caiuspoputa/agendasalon/UpdateApkProvider.java']:
    del stubs[name]
stubs['android/app/Activity.java']='''package android.app;public class Activity {
public final android.content.pm.PackageManager pm=new android.content.pm.PackageManager();
public final java.util.List<android.content.Intent> opened=new java.util.ArrayList<>();public boolean missingBrowser;
public android.content.pm.PackageManager getPackageManager(){return pm;}public String getPackageName(){return "ro.caiuspoputa.agendasalon";}
public void runOnUiThread(Runnable r){r.run();}public void startActivity(android.content.Intent i){if(missingBrowser)throw new RuntimeException("Missing browser");opened.add(i);}
}'''
stubs['android/content/Intent.java']='''package android.content;public class Intent {
public static final String ACTION_VIEW="android.intent.action.VIEW",CATEGORY_BROWSABLE="android.intent.category.BROWSABLE";
public final String action;public final android.net.Uri uri;public final java.util.Set<String> categories=new java.util.HashSet<>();
public Intent(String action,android.net.Uri uri){this.action=action;this.uri=uri;}public Intent addCategory(String c){categories.add(c);return this;}
}'''
stubs['android/net/Uri.java']='package android.net;public class Uri {private final String raw;private Uri(String s){raw=s;}public static Uri parse(String raw){return new Uri(raw);}public String toString(){return raw;}}'
stubs['android/os/SystemClock.java']='package android.os;public class SystemClock {public static long shift;public static long elapsedRealtime(){return System.nanoTime()/1000000+shift;}}'
stubs['ro/caiuspoputa/agendasalon/NativeUpdateBrowserTest.java']=r'''package ro.caiuspoputa.agendasalon;
import org.json.JSONObject;import java.net.*;import java.io.*;import java.nio.charset.StandardCharsets;import java.util.*;
public final class NativeUpdateBrowserTest {
static int checks;static final List<String> requests=new ArrayList<>();static String body;
static void check(boolean yes,String message){checks++;if(!yes)throw new AssertionError(message);}
static String metadata(int code,int min,String url)throws Exception{return new JSONObject().put("versionCode",code).put("versionName","1.1.4").put("minSdk",min).put("size",123).put("sha256","a".repeat(64)).put("apkUrl",url).toString();}
static final String URL=UpdatePolicy.REPOSITORY+"/releases/download/v1.1.4/Agenda-Salon-1.1.4.apk";
static final class Probe implements AutoCloseable {
 final android.app.Activity activity=new android.app.Activity();final AppUpdater updater=new AppUpdater(activity,(id,value)->{});
 Probe(){activity.pm.installed.versionCode=38;activity.pm.installed.versionName="1.1.3";}
 String status(String id)throws Exception{return new JSONObject(updater.resultFor(id)).getJSONObject("result").getString("status");}
 void checked(String id,String expected)throws Exception{updater.check(id);long end=System.nanoTime()+2_000_000_000L;while(System.nanoTime()<end){String raw=updater.resultFor(id);if(!raw.isEmpty()&&"terminal".equals(new JSONObject(raw).getString("stage")))break;Thread.sleep(5);}check(expected.equals(status(id)),"metadata: "+expected);}
 void open(String id)throws Exception{updater.queueResult(id);updater.openDownload(id);}
 public void close(){updater.destroy();}
}
public static void main(String[] args)throws Exception {
 java.net.URL.setURLStreamHandlerFactory(protocol->"https".equals(protocol)?new URLStreamHandler(){protected URLConnection openConnection(java.net.URL url){requests.add(url.toString());check(UpdatePolicy.METADATA_URL.equals(url.toString()),"app must never download the APK");return new HttpURLConnection(url){public void connect(){}public boolean usingProxy(){return false;}public void disconnect(){}public int getResponseCode(){return 200;}public long getContentLengthLong(){return body.getBytes(StandardCharsets.UTF_8).length;}public InputStream getInputStream(){return new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8));}};}}:null);
 body=metadata(39,26,URL);
 try(Probe p=new Probe()){
  p.open("no-check");check("error".equals(p.status("no-check")),"no unchecked URL");check(p.activity.opened.isEmpty()&&requests.isEmpty(),"no automatic opening/network");
  p.checked("check-1","available");check(p.activity.opened.isEmpty(),"check alone cannot open browser");int count=requests.size();
  p.open("open-1");check("browser".equals(p.status("open-1")),"browser result terminal");check(p.activity.opened.size()==1,"one explicit opening");check(requests.size()==count,"opening performs no native download");
  android.content.Intent intent=p.activity.opened.get(0);check(android.content.Intent.ACTION_VIEW.equals(intent.action),"view action");check(URL.equals(intent.uri.toString()),"exact validated official URL");check(intent.categories.contains(android.content.Intent.CATEGORY_BROWSABLE),"browsable URL");
  p.open("open-1");check(p.activity.opened.size()==1,"duplicate bridge id must not reopen");
  android.os.SystemClock.shift=24L*60*60*1000+1;p.open("expired");check("error".equals(p.status("expired"))&&p.activity.opened.size()==1,"expired metadata cannot open");android.os.SystemClock.shift=0;
  p.activity.pm.installed.versionCode=39;p.open("not-newer");check("error".equals(p.status("not-newer"))&&p.activity.opened.size()==1,"no stale version after installation");p.activity.pm.installed.versionCode=38;
  p.activity.missingBrowser=true;p.open("missing-browser");check("error".equals(p.status("missing-browser")),"missing browser has actionable result");p.activity.missingBrowser=false;p.open("retry-browser");check("browser".equals(p.status("retry-browser"))&&p.activity.opened.size()==2,"explicit retry succeeds");
  p.updater.openDownload("bad/id");check(p.activity.opened.size()==2,"invalid id rejected");p.updater.destroy();p.updater.openDownload("after-destroy");check(p.activity.opened.size()==2,"destroyed activity cannot open");
 }
 for(String invalid:new String[]{URL.replace("https:","http:"),URL.replace("agenda-salon","other"),URL+"?redirect=https://evil.example","file:///sdcard/Download/a.apk","content://anything/a.apk","intent://anything/#Intent;end",URL.replace("1.1.4.apk","1.1.3.apk")}){
  body=metadata(39,26,invalid);try(Probe p=new Probe()){p.checked("bad-source","error");p.open("open-bad-source");check("error".equals(p.status("open-bad-source")),"bad metadata cannot authorize opening");check(p.activity.opened.isEmpty(),"no invalid destination launched");}
 }
 body=metadata(39,100,URL);try(Probe p=new Probe()){p.checked("unsupported","error");p.open("open-unsupported");check(p.activity.opened.isEmpty(),"unsupported Android cannot open");}
 body=metadata(38,26,URL);try(Probe p=new Probe()){p.checked("current","current");p.open("open-current");check(p.activity.opened.isEmpty(),"current version cannot open");}
 check(requests.stream().allMatch(UpdatePolicy.METADATA_URL::equals),"metadata-only network throughout");
 System.out.println("PASS native browser updater: "+checks+" assertions; exact URL, explicit action, replay protection, stale checks, missing browser, no APK download or installer permissions.");
}
}'''
with tempfile.TemporaryDirectory(prefix='salon-browser-updater-') as directory:
    root=Path(directory)
    for name,content in stubs.items():
        path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(content,encoding='utf-8')
    classes=root/'classes'
    sources=[str(p) for p in root.rglob('*.java')]+[str(source/name) for name in ('AppUpdater.java','UpdatePolicy.java','UpdateResultMailbox.java')]
    subprocess.run([str(java/'javac.exe'),'-encoding','UTF-8','-cp',str(json_classes),'-d',str(classes),*sources],check=True,timeout=30)
    subprocess.run([str(java/'java.exe'),'-cp',str(classes)+';'+str(json_classes),'ro.caiuspoputa.agendasalon.NativeUpdateBrowserTest'],check=True,timeout=15)
