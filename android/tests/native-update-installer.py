"""Production updater/provider with isolated Android adapters and HTTPS fixtures.
Tests consent, lifecycle, integrity, signer/package checks and private cache only.
No real installer, network, device, credentials or salon data is accessed.
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
for name in ['ro/caiuspoputa/agendasalon/NativeUpdateNetworkTest.java','ro/caiuspoputa/agendasalon/UpdateApkProvider.java']:del stubs[name]
stubs.update({
'android/content/Context.java':'''package android.content;public class Context {
public java.io.File cache;public java.io.File getCacheDir(){return cache;}
public String getPackageName(){return "ro.caiuspoputa.agendasalon";}}''',
'android/app/Activity.java':'''package android.app;public class Activity extends android.content.Context {
public final android.content.pm.PackageManager pm=new android.content.pm.PackageManager();
public final java.util.List<android.content.Intent> opened=new java.util.concurrent.CopyOnWriteArrayList<>();public boolean missingInstaller;
public android.content.pm.PackageManager getPackageManager(){return pm;}
public void runOnUiThread(Runnable r){r.run();}public void startActivity(android.content.Intent i){if(missingInstaller)throw new RuntimeException("missing activity");opened.add(i);}}''',
'android/content/Intent.java':'''package android.content;public class Intent {
public static final String ACTION_VIEW="VIEW",CATEGORY_BROWSABLE="BROWSABLE";public static final int FLAG_GRANT_READ_URI_PERMISSION=1;
public final String action;public android.net.Uri uri;public String mime;public int flags;public ClipData clip;
public Intent(String a){action=a;}public Intent(String a,android.net.Uri u){action=a;uri=u;}
public Intent setDataAndType(android.net.Uri u,String m){uri=u;mime=m;return this;}
public Intent addCategory(String c){throw new AssertionError("No browser handoff allowed");}
public void setClipData(ClipData d){clip=d;}public Intent addFlags(int f){flags|=f;return this;}}''',
'android/content/ClipData.java':'''package android.content;public class ClipData {public static ClipData newRawUri(String name,android.net.Uri uri){return new ClipData();}}''',
'android/content/pm/PackageManager.java':'''package android.content.pm;public class PackageManager {
public static final int GET_SIGNING_CERTIFICATES=1,GET_SIGNATURES=2;public final PackageInfo installed=new PackageInfo();
public PackageInfo archive=new PackageInfo();public boolean permission=true;
public PackageInfo getPackageInfo(String name,int flags){return installed;}public PackageInfo getPackageArchiveInfo(String name,int flags){return archive;}
public boolean canRequestPackageInstalls(){return permission;}}''',
'android/content/pm/Signature.java':'''package android.content.pm;public class Signature {public byte[] bytes={1,2,3};public byte[] toByteArray(){return bytes;}}''',
'android/content/pm/SigningInfo.java':'''package android.content.pm;public class SigningInfo {public Signature[] values={new Signature()};public Signature[] getApkContentsSigners(){return values;}}''',
'android/net/Uri.java':'''package android.net;public class Uri {
private final java.net.URI raw;private Uri(String s){raw=java.net.URI.create(s);}public static Uri parse(String s){return new Uri(s);}
public String toString(){return raw.toString();}public String getScheme(){return raw.getScheme();}public String getAuthority(){return raw.getAuthority();}
public String getQuery(){return raw.getQuery();}public String getFragment(){return raw.getFragment();}public String getPath(){return raw.getPath();}
public String getLastPathSegment(){String p=getPath();return p.substring(p.lastIndexOf('/')+1);}
public static class Builder {String s,a,p="";public Builder scheme(String v){s=v;return this;}public Builder authority(String v){a=v;return this;}
public Builder appendPath(String v){p+="/"+v;return this;}public Uri build(){return Uri.parse(s+"://"+a+p);}}}''',
'android/os/SystemClock.java':'''package android.os;public class SystemClock {public static long shift;public static long elapsedRealtime(){return System.nanoTime()/1000000+shift;}}''',
'android/content/ContentProvider.java':'''package android.content;public abstract class ContentProvider {public Context context;public Context getContext(){return context;}
public abstract boolean onCreate();public abstract String getType(android.net.Uri u);public abstract android.os.ParcelFileDescriptor openFile(android.net.Uri u,String m)throws java.io.FileNotFoundException;
public abstract android.database.Cursor query(android.net.Uri u,String[] p,String s,String[] a,String sort);
public abstract android.net.Uri insert(android.net.Uri u,ContentValues v);public abstract int update(android.net.Uri u,ContentValues v,String s,String[] a);public abstract int delete(android.net.Uri u,String s,String[] a);}''',
'android/content/ContentValues.java':'package android.content;public class ContentValues {}',
'android/database/Cursor.java':'package android.database;public interface Cursor {}',
'android/database/MatrixCursor.java':'''package android.database;public class MatrixCursor implements Cursor {public Object[] row;public MatrixCursor(String[] c){}public void addRow(Object[] r){row=r;}}''',
'android/provider/OpenableColumns.java':'package android.provider;public class OpenableColumns {public static final String DISPLAY_NAME="_display_name",SIZE="_size";}',
'android/os/ParcelFileDescriptor.java':'''package android.os;public class ParcelFileDescriptor {public static final int MODE_READ_ONLY=1;public java.io.File file;public int mode;
public static ParcelFileDescriptor open(java.io.File f,int m)throws java.io.FileNotFoundException {if(!f.isFile())throw new java.io.FileNotFoundException();ParcelFileDescriptor p=new ParcelFileDescriptor();p.file=f;p.mode=m;return p;}}'''
})
stubs['ro/caiuspoputa/agendasalon/NativeUpdateInstallerTest.java']=r'''package ro.caiuspoputa.agendasalon;
import org.json.JSONObject;import java.net.*;import java.io.*;import java.nio.charset.StandardCharsets;import java.nio.file.*;import java.security.*;import java.util.*;
public final class NativeUpdateInstallerTest {
static int assertions,downloads;static String body;static byte[] bytes;static boolean badLength,networkFailure,pausedRead;static int statusCode=200;static String redirect;
static final byte[] GOOD="APK fixture independently parsed by PackageManager adapter".getBytes(StandardCharsets.UTF_8);
static final String RELEASE=UpdatePolicy.REPOSITORY+"/releases/download/v1.1.5/Agenda-Salon-1.1.5.apk";
static final String DIRECT="https://caiuspoputa-debug.github.io/aplicatii/downloads/salon/1.1.5/Agenda-Salon-1.1.5.apk";
static String hash(byte[] data)throws Exception{return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));}
static void check(boolean yes,String message){assertions++;if(!yes)throw new AssertionError(message);}
interface Attempt{void run()throws Exception;}
static void rejected(Attempt a)throws Exception{try{a.run();}catch(Exception expected){assertions++;return;}throw new AssertionError("Unsafe provider access accepted");}
static void reset()throws Exception{body=new JSONObject().put("versionCode",40).put("versionName","1.1.5").put("minSdk",26).put("size",GOOD.length).put("sha256",hash(GOOD)).put("apkUrl",RELEASE).toString();bytes=GOOD;badLength=networkFailure=pausedRead=false;statusCode=200;redirect=null;android.os.SystemClock.shift=0;}
static final class Probe implements AutoCloseable {
 final android.app.Activity a=new android.app.Activity();final AppUpdater u=new AppUpdater(a,(id,value)->{});
 Probe()throws Exception {a.cache=Files.createTempDirectory(Path.of(System.getProperty("fixtureRoot")),"cache-").toFile();a.pm.installed.versionCode=39;a.pm.installed.versionName="1.1.4";a.pm.archive.versionCode=40;a.pm.archive.versionName="1.1.5";u.onResume();}
 JSONObject receipt(String id)throws Exception{String raw=u.resultFor(id);return raw.isEmpty()?new JSONObject():new JSONObject(raw);}
 String status(String id)throws Exception{return receipt(id).optJSONObject("result")==null?"":receipt(id).getJSONObject("result").optString("status");}
 void waitFor(String id,String status)throws Exception{long end=System.nanoTime()+3_000_000_000L;while(System.nanoTime()<end&&!status.equals(status(id)))Thread.sleep(4);check(status.equals(status(id)),id+" expected "+status+" got "+receipt(id));}
 void checked()throws Exception{u.check("check");waitFor("check","available");check(a.opened.isEmpty(),"checking must never launch installer");}
 void install()throws Exception{u.queueResult("install");u.openDownload("install");}
 void noApk()throws Exception{check(a.opened.stream().noneMatch(i->"VIEW".equals(i.action)),"unverified APK must never launch");}
 public void close(){u.destroy();}
}
public static void main(String[] args)throws Exception{
 java.net.URL.setURLStreamHandlerFactory(protocol->"https".equals(protocol)?new URLStreamHandler(){protected URLConnection openConnection(java.net.URL url){boolean meta=url.toString().equals(UpdatePolicy.METADATA_URL);if(!meta){check(url.toString().equals(DIRECT),"only exact Salon Pages APK can be fetched");downloads++;}return new HttpURLConnection(url){
 public void connect(){}public boolean usingProxy(){return false;}public void disconnect(){}public int getResponseCode()throws IOException{if(!meta&&networkFailure)throw new IOException("fixture offline");return meta?200:statusCode;}
 public String getHeaderField(String name){return redirect;}
 public long getContentLengthLong(){return meta?body.getBytes(StandardCharsets.UTF_8).length:badLength?GOOD.length+1:-1;}
 public InputStream getInputStream()throws IOException{if(!meta&&pausedRead){try{Thread.sleep(120);}catch(InterruptedException e){throw new IOException(e);}}return new ByteArrayInputStream(meta?body.getBytes(StandardCharsets.UTF_8):bytes);}};}}:null);
 reset();try(Probe p=new Probe()){p.install();p.waitFor("install","error");p.noApk();check(downloads==0,"no unchecked download");}
 reset();try(Probe p=new Probe()){
  p.checked();p.install();p.waitFor("install","installer");check(p.a.opened.size()==1,"one installer");android.content.Intent intent=p.a.opened.get(0);
  check(intent.uri.toString().equals("content://ro.caiuspoputa.agendasalon.updates/apk/"+hash(GOOD)+".apk"),"scoped content URI");check(intent.flags==1&&intent.clip!=null&&UpdateApkProvider.MIME.equals(intent.mime),"read-only URI grant with APK MIME");
  int n=downloads;p.u.openDownload("install");check(p.a.opened.size()==1&&downloads==n,"duplicate request cannot reinstall");
  p.u.openDownload("retry");p.waitFor("retry","installer");check(downloads==n,"verified cache reused after cancel/retry");
  UpdateApkProvider provider=new UpdateApkProvider();provider.context=p.a;check(provider.onCreate(),"provider created");check(provider.openFile(intent.uri,"r").mode==1,"provider read only");
  rejected(()->provider.openFile(intent.uri,"rw"));rejected(()->provider.delete(intent.uri,null,null));rejected(()->provider.insert(intent.uri,new android.content.ContentValues()));
  for(String raw:new String[]{intent.uri+"?x=1",intent.uri+"#x",intent.uri.toString().replace(".updates/",".other/"),"content://ro.caiuspoputa.agendasalon.updates/apk/../secret","content://ro.caiuspoputa.agendasalon.updates/apk/%2e%2e/secret","file:///data/secret"})rejected(()->provider.openFile(android.net.Uri.parse(raw),"r"));
  check(new File(UpdateApkProvider.directory(p.a),"download.part").exists()==false,"partial file cleaned");
 }
 reset();try(Probe p=new Probe()){
  p.a.pm.permission=false;p.checked();int n=downloads;p.install();p.waitFor("install","permission");check("progress".equals(p.receipt("install").getString("stage")),"permission must not finish request");check(downloads==n,"no download before consent");
  p.u.onResume();check(downloads==n,"initial resume cannot auto-launch before permission screen");p.u.onPause();p.a.pm.permission=true;p.u.onResume();p.waitFor("install","installer");check(p.a.opened.size()==2,"permission then installer without second click");p.u.onResume();check(p.a.opened.size()==2,"resume cannot reopen installer");
 }
 reset();try(Probe p=new Probe()){p.a.pm.permission=false;p.checked();p.install();p.u.onPause();p.u.onResume();p.waitFor("install","error");p.noApk();}
 reset();try(Probe p=new Probe()){p.checked();p.u.onPause();p.install();Thread.sleep(180);check("downloading".equals(p.status("install")),"background result waits for foreground");p.noApk();p.u.onResume();p.waitFor("install","installer");}
 for(int scenario=0;scenario<11;scenario++){
  reset();try(Probe p=new Probe()){
   p.checked();switch(scenario){case 0:bytes="corrupt".getBytes();break;case 1:bytes=GOOD.clone();bytes[0]^=1;break;case 2:badLength=true;break;case 3:networkFailure=true;break;
   case 4:p.a.pm.archive.packageName="other.app";break;case 5:p.a.pm.archive.versionCode=39;break;case 6:p.a.pm.archive.versionName="1.1.6";break;
   case 7:p.a.pm.archive.signingInfo.values[0].bytes=new byte[]{9};break;case 8:p.a.pm.archive.applicationInfo.minSdkVersion=99;break;case 9:p.a.pm.archive=null;break;case 10:statusCode=302;redirect="https://evil.example/apk";break;}
   p.install();p.waitFor("install","error");p.noApk();
   long end=System.nanoTime()+500_000_000L;while(new File(UpdateApkProvider.directory(p.a),"download.part").exists()&&System.nanoTime()<end)Thread.sleep(5);
   check(!new File(UpdateApkProvider.directory(p.a),"download.part").exists(),"failed transfer discarded");
  }
 }
 reset();try(Probe p=new Probe()){p.checked();p.a.missingInstaller=true;p.install();p.waitFor("install","error");p.a.missingInstaller=false;p.u.openDownload("retry");p.waitFor("retry","installer");}
 reset();try(Probe p=new Probe()){p.checked();pausedRead=true;p.install();p.u.destroy();Thread.sleep(180);p.noApk();check(p.u.resultFor("install").isEmpty(),"destroyed operation has no late result");}
 reset();try(Probe p=new Probe()){p.checked();android.os.SystemClock.shift=24L*60*60*1000+1;p.install();p.waitFor("install","error");p.noApk();}
 reset();try(Probe p=new Probe()){p.a.pm.permission=false;p.checked();p.install();p.u.onPause();android.os.SystemClock.shift=300001;p.a.pm.permission=true;p.u.onResume();p.waitFor("install","error");p.noApk();}
 reset();try(Probe p=new Probe()){p.checked();p.a.pm.installed.versionCode=40;p.install();p.waitFor("install","error");p.noApk();}
 System.out.println("PASS native integrated updater/provider: "+assertions+" assertions; consent auto-resume, scoped read grant, integrity/signers, private cache, background/destroy lifecycle, invalid APK and network failures.");
}
}'''
with tempfile.TemporaryDirectory(prefix='salon-installer-') as directory:
    root=Path(directory)
    for name,content in stubs.items():
        path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(content,encoding='utf-8')
    classes=root/'classes'
    sources=[str(path) for path in root.rglob('*.java')]+[str(source/name) for name in ['AppUpdater.java','UpdatePolicy.java','UpdateResultMailbox.java','UpdateApkProvider.java']]
    subprocess.run([str(java/'javac.exe'),'-encoding','UTF-8','-cp',str(json_classes),'-d',str(classes),*sources],check=True,timeout=30)
    subprocess.run([str(java/'java.exe'),'-DfixtureRoot='+str(root),'-cp',str(classes)+';'+str(json_classes),'ro.caiuspoputa.agendasalon.NativeUpdateInstallerTest'],check=True,timeout=30)
