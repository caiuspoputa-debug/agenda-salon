"""Execute production browser handoff with controlled metadata and Android adapters."""
from pathlib import Path
import ast,re,subprocess,tempfile
from native_update_test_support import json_runtime
base=Path(__file__).resolve().parents[1];source=base/'app/src/main/java/ro/caiuspoputa/agendasalon'
java=Path('C:/Program Files/Android/Android Studio/jbr/bin');json_classes=json_runtime(base)
fixture=base/'tests/native-update-network.py';tree=ast.parse(fixture.read_text(encoding='utf-8'))
assignment=next(n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='stubs' for t in n.targets))
callback=re.search(r'    private void deliverAppUpdateResult\([^\n]+\) \{\n.*?\n    \}',(source/'MainActivity.java').read_text(encoding='utf-8'),re.S)
ns={'callback':callback};exec(compile(ast.Module(body=[assignment],type_ignores=[]),str(fixture),'exec'),ns);stubs=ns['stubs']
del stubs['ro/caiuspoputa/agendasalon/NativeUpdateNetworkTest.java']
stubs.update({
'android/app/Activity.java':'''package android.app; public class Activity {
public final android.content.pm.PackageManager pm=new android.content.pm.PackageManager();
public final java.util.List<android.content.Intent> opened=new java.util.ArrayList<>(); public boolean missing;
public android.content.pm.PackageManager getPackageManager(){return pm;}
public String getPackageName(){return "ro.caiuspoputa.agendasalon";}
public void runOnUiThread(Runnable r){r.run();}public void startActivity(android.content.Intent i){if(missing)throw new RuntimeException();opened.add(i);}}''',
'android/content/Intent.java':'''package android.content;public class Intent {
public static final String ACTION_VIEW="VIEW",CATEGORY_BROWSABLE="BROWSABLE";
public String action,category,provider;public android.net.Uri uri;
public Intent(String a,android.net.Uri u){action=a;uri=u;}public Intent addCategory(String c){category=c;return this;}public Intent setPackage(String p){provider=p;return this;}}''',
'android/net/Uri.java':'''package android.net;public class Uri {private final String raw;private Uri(String s){raw=s;}public static Uri parse(String s){return new Uri(s);}public String toString(){return raw;}}''',
'android/os/SystemClock.java':'''package android.os;public class SystemClock {public static long shift;public static long elapsedRealtime(){return System.nanoTime()/1000000+shift;}}'''
})
stubs['ro/caiuspoputa/agendasalon/NativeUpdateBrowserTest.java']=r'''package ro.caiuspoputa.agendasalon;
import org.json.*;import java.net.*;import java.io.*;import java.nio.charset.StandardCharsets;
public final class NativeUpdateBrowserTest {
static int assertions,reads;static String body;
static final String URL_APK="https://github.com/caiuspoputa-debug/agenda-salon/releases/download/v1.1.7/Agenda-Salon-1.1.7.apk";
static void ok(boolean b,String m){assertions++;if(!b)throw new AssertionError(m);}
static String metadata(String url,int code)throws Exception{return new JSONObject().put("versionCode",code).put("versionName","1.1.7").put("minSdk",26).put("size",1234).put("sha256","a".repeat(64)).put("apkUrl",url).toString();}
static JSONObject waitFor(AppUpdater u,String id)throws Exception {long end=System.nanoTime()+3_000_000_000L;while(System.nanoTime()<end){String s=u.resultFor(id);if(!s.isEmpty()){JSONObject j=new JSONObject(s);if("terminal".equals(j.optString("stage")))return j.getJSONObject("result");}Thread.sleep(5);}throw new AssertionError("No result");}
static void status(AppUpdater u,String id,String expected)throws Exception{ok(expected.equals(waitFor(u,id).getString("status")),id+" status");}
public static void main(String[] args)throws Exception {
URL.setURLStreamHandlerFactory(protocol->"https".equals(protocol)?new URLStreamHandler(){protected URLConnection openConnection(URL u){ok(UpdatePolicy.METADATA_URL.equals(u.toString()),"Only metadata may be fetched inside Salon");reads++;return new HttpURLConnection(u){public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}public int getResponseCode(){return 200;}public InputStream getInputStream(){return new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8));}};}}:null);
android.app.Activity a=new android.app.Activity();a.pm.installed.versionCode=41;AppUpdater u=new AppUpdater(a,(id,r)->{});
try {
u.openDownload("unchecked");status(u,"unchecked","error");ok(a.opened.isEmpty(),"No browser without check");
body=metadata(URL_APK,42);u.check("check");status(u,"check","available");ok(a.opened.isEmpty(),"Check cannot open browser");int before=reads;
u.openDownload("download");status(u,"download","browser");ok(a.opened.size()==1,"Single explicit browser");
android.content.Intent intent=a.opened.get(0);ok("VIEW".equals(intent.action),"View action");ok("BROWSABLE".equals(intent.category),"Browsable category");ok("fixture.browser".equals(intent.provider),"Pinned browser package");ok(URL_APK.equals(intent.uri.toString()),"Exact validated URL");ok(reads==before,"No APK download by application");
u.openDownload("download");ok(a.opened.size()==1,"Duplicate terminal request cannot reopen browser");
android.os.SystemClock.shift=24L*60*60*1000+1;u.openDownload("expired");status(u,"expired","error");ok(a.opened.size()==1,"Expired metadata rejected");android.os.SystemClock.shift=0;
androidx.browser.customtabs.CustomTabsClient.provider=null;u.openDownload("missing");status(u,"missing","error");ok(a.opened.size()==1,"Missing browser has no installer fallback");androidx.browser.customtabs.CustomTabsClient.provider="fixture.browser";
a.missing=true;u.openDownload("activity-fails");status(u,"activity-fails","error");a.missing=false;
body=metadata(URL_APK,41);u.check("current");status(u,"current","current");u.openDownload("not-newer");status(u,"not-newer","error");ok(a.opened.size()==1,"Current version cannot download");
int i=0;for(String invalid:new String[]{URL_APK.replace("https:","http:"),URL_APK.replace("agenda-salon","tool-upload-iphone"),URL_APK+"?redirect=x",URL_APK+"#x","content://a/b","file:///sdcard/a.apk","intent://a"}){body=metadata(invalid,42);String id="bad-"+(i++);u.check(id);status(u,id,"error");u.openDownload(id+"-download");status(u,id+"-download","error");}
ok(a.opened.size()==1,"Rejected sources never open browser");
u.destroy();u.openDownload("destroyed");ok(a.opened.size()==1,"Destroyed activity cannot open browser");
System.out.println("PASS native browser handoff: "+assertions+" assertions; no APK fetch, installer, device or external network");
} finally {u.destroy();}
}
}'''
with tempfile.TemporaryDirectory(prefix='salon-browser-') as directory:
    root=Path(directory)
    for name,content in stubs.items():
        p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(content,encoding='utf-8')
    classes=root/'classes';sources=[str(p) for p in root.rglob('*.java')]+[str(source/n) for n in ['AppUpdater.java','UpdatePolicy.java','UpdateResultMailbox.java']]
    subprocess.run([str(java/'javac.exe'),'-encoding','UTF-8','-cp',str(json_classes),'-d',str(classes),*sources],check=True,timeout=30)
    subprocess.run([str(java/'java.exe'),'-cp',str(classes)+';'+str(json_classes),'ro.caiuspoputa.agendasalon.NativeUpdateBrowserTest'],check=True,timeout=15)
