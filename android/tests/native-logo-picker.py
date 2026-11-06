"""Execute the actual MainActivity raster file-chooser methods using service adapters.

No device, Android picker, file content, permissions, network or salon data is
accessed. Uri and Intent adapters only model the selected document contract.
"""
from pathlib import Path
import re
import subprocess
import sys
import tempfile

sys.stdout.reconfigure(encoding='utf-8')
base = Path(__file__).resolve().parents[1]
source = base / 'app/src/main/java/ro/salon/agenda/test/MainActivity.java'
main = source.read_text(encoding='utf-8')
java = Path('C:/Program Files/Android/Android Studio/jbr/bin')

def method(name, indent=4):
    match = re.search(r'^' + ' ' * indent + r'(?:private|public|protected) (?:static )?[\w<>\[\].]+ ' + name + r'\([^)]*\) \{\n.*?^' + ' ' * indent + r'\}', main, re.M | re.S)
    assert match, 'Actual MainActivity method missing: ' + name
    return match.group(0)

# Wiring is verified against the activity source; method behavior below is actual
# source extraction, not a second implementation of the chooser.
assert 'return showLogoFileChooser(view, callback, parameters);' in main
assert 'if (requestCode == PICK_LOGO_IMAGE) { handleLogoImageResult(resultCode, data); return; }' in main
assert 'private static final int PICK_LOGO_IMAGE = 1004;' in main
assert 'if (view == webView) completeLogoPicker(null);' in main
destroy_prelude = re.search(r'        destroyed = true;\n        completeLogoPicker\(null\);\n        logoPickerOpen = false;\n        documentPickerOpen = false;', main)
assert destroy_prelude
assert main.index(destroy_prelude.group(0)) < main.index('            webView.destroy();')

stubs = {
'android/net/Uri.java': '''package android.net;public final class Uri {
private final String text;private final java.net.URI value;private Uri(String text){this.text=text;this.value=java.net.URI.create(text);}
public static Uri parse(String text){return new Uri(text);}public String getScheme(){return value.getScheme();}
public String getAuthority(){return value.getAuthority();}public String getFragment(){return value.getFragment();}
@Override public String toString(){return text;}@Override public boolean equals(Object other){return other instanceof Uri&&text.equals(((Uri)other).text);}@Override public int hashCode(){return text.hashCode();}
}''',
'android/content/ClipData.java': '''package android.content;import android.net.Uri;public final class ClipData {
private final Uri[] values;public ClipData(Uri... values){this.values=values;}public int getItemCount(){return values.length;}
public Item getItemAt(int index){return new Item(values[index]);}public static final class Item {private final Uri value;Item(Uri value){this.value=value;}public Uri getUri(){return value;}}
}''',
'android/content/Intent.java': '''package android.content;import android.net.Uri;import java.util.*;public final class Intent {
public static final String ACTION_OPEN_DOCUMENT="android.intent.action.OPEN_DOCUMENT",CATEGORY_OPENABLE="android.intent.category.OPENABLE",EXTRA_MIME_TYPES="mime-types",EXTRA_ALLOW_MULTIPLE="multiple";
public static final int FLAG_GRANT_READ_URI_PERMISSION=1;public final String action;public String type;public final Set<String> categories=new HashSet<>();public final Map<String,Object> extras=new HashMap<>();public int flags;private Uri data;private ClipData clips;
public Intent(String action){this.action=action;}public Intent addCategory(String c){categories.add(c);return this;}public Intent setType(String t){type=t;return this;}public Intent putExtra(String k,String[] v){extras.put(k,v);return this;}public Intent putExtra(String k,boolean v){extras.put(k,v);return this;}public Intent addFlags(int f){flags|=f;return this;}public Intent setData(Uri v){data=v;return this;}public Uri getData(){return data;}public Intent setClipData(ClipData v){clips=v;return this;}public ClipData getClipData(){return clips;}
}'''
}
methods = '\n'.join(method(name) for name in ('isHome', 'trustedPage', 'isLogoImageChooser', 'showLogoFileChooser', 'completeLogoPicker', 'handleLogoImageResult'))
stubs['ro/salon/agenda/test/NativeLogoPickerTest.java'] = '''package ro.salon.agenda.test;
import java.util.*;import android.net.Uri;import android.content.Intent;import android.content.ClipData;
interface ValueCallback<T>{void onReceiveValue(T value);}
final class WebView {String url="file:///android_asset/index.html";String getUrl(){return url;}}
final class WebChromeClient {static final class FileChooserParams {static final int MODE_OPEN=0,MODE_OPEN_MULTIPLE=1,MODE_SAVE=3;final int mode;final boolean capture;final String[] accepts;FileChooserParams(int mode,boolean capture,String... accepts){this.mode=mode;this.capture=capture;this.accepts=accepts;}int getMode(){return mode;}boolean isCaptureEnabled(){return capture;}String[] getAcceptTypes(){return accepts;}}}
public final class NativeLogoPickerTest {
static int checks;static void check(boolean ok,String message){checks++;if(!ok)throw new AssertionError(message);}
static WebChromeClient.FileChooserParams params(String... types){return new WebChromeClient.FileChooserParams(0,false,types);}
static final class Result implements ValueCallback<Uri[]> {int calls;Uri[] value;boolean fail;public void onReceiveValue(Uri[] value){calls++;this.value=value;if(fail)throw new RuntimeException("document destroyed");}}
static final class Probe {
private static final String HOME="file:///android_asset/index.html";private static final int PICK_LOGO_IMAGE=1004,RESULT_OK=-1;
boolean destroyed,finishing,activityDestroyed,documentPickerOpen,logoPickerOpen,launchFailure,resolverFailure;String pendingContactRequestId,mime="image/png";ValueCallback<Uri[]> pendingLogoCallback;WebView pendingLogoWebView,webView=new WebView();Intent launched;int request,starts,typeReads;
boolean isFinishing(){return finishing;}boolean isDestroyed(){return activityDestroyed;}
void startActivityForResult(Intent intent,int requestCode){starts++;if(launchFailure)throw new RuntimeException("no document picker");launched=intent;request=requestCode;}
Probe getContentResolver(){return this;}String getType(Uri selected){typeReads++;if(resolverFailure)throw new SecurityException("permission denied");return mime;}
''' + methods + '''
void navigate(WebView view){if(view==webView)completeLogoPicker(null);}
void destroy(){
''' + destroy_prelude.group(0) + '''
}
}
static Result open(Probe p){Result r=new Result();check(p.showLogoFileChooser(p.webView,r,params("image/png","image/jpeg","image/webp")),"chooser handled");check(r.calls==0&&p.starts==1&&p.documentPickerOpen&&p.logoPickerOpen,"exactly one pending picker");return r;}
static Intent selected(String uri){return new Intent("result").setData(uri==null?null:Uri.parse(uri));}
static void assertCancelled(Probe p,Result r){check(r.calls==1&&r.value==null,"single cancelled completion");check(!p.logoPickerOpen&&!p.documentPickerOpen&&p.pendingLogoCallback==null&&p.pendingLogoWebView==null,"picker ownership released");p.handleLogoImageResult(-1,selected("content://documents/late.png"));check(r.calls==1,"late duplicate result ignored");}
static void accepts(){
 for(String[] types:new String[][]{{"image/png"},{"image/jpeg"},{"image/webp"},{"image/png,image/jpeg,image/webp"},{".png",".jpg",".jpeg",".webp"},{" IMAGE/PNG "}})check(Probe.isLogoImageChooser(params(types)),"supported explicit raster accept");
 for(String[] types:new String[][]{null,new String[]{},new String[]{null},new String[]{""},new String[]{"image/*"},new String[]{"*/*"},new String[]{"image/svg+xml"},new String[]{"image/png, image/svg+xml"},new String[]{"image/png,"},new String[]{"application/pdf"}})check(!Probe.isLogoImageChooser(params(types)),"unsupported or ambiguous accept denied");
 check(!Probe.isLogoImageChooser(null),"missing parameters denied");check(!Probe.isLogoImageChooser(new WebChromeClient.FileChooserParams(1,false,"image/png")),"multiple mode denied");check(!Probe.isLogoImageChooser(new WebChromeClient.FileChooserParams(3,false,"image/png")),"save mode denied");check(!Probe.isLogoImageChooser(new WebChromeClient.FileChooserParams(0,true,"image/png")),"camera capture denied");
 System.out.println("PASS raster accept/type/mode/capture constraints");
}
static void guards(){
 for(String reason:new String[]{"destroyed","finishing","activityDestroyed","other-view","foreign-page","home-query","home-fragment","backup-busy","contact-busy","invalid-accept"}){
  Probe p=new Probe();WebView view=p.webView;WebChromeClient.FileChooserParams types=params("image/png");
  switch(reason){case "destroyed":p.destroyed=true;break;case "finishing":p.finishing=true;break;case "activityDestroyed":p.activityDestroyed=true;break;case "other-view":view=new WebView();break;case "foreign-page":p.webView.url="https://evil.invalid/";break;case "home-query":p.webView.url+="?x=1";break;case "home-fragment":p.webView.url+="#x";break;case "backup-busy":p.documentPickerOpen=true;break;case "contact-busy":p.pendingContactRequestId="contact-1";break;case "invalid-accept":types=params("image/*");break;}
  Result r=new Result();check(p.showLogoFileChooser(view,r,types),"guard callback consumed");check(r.calls==1&&r.value==null&&p.starts==0&&p.pendingLogoCallback==null,"denied without a picker: "+reason);
 }
 Probe p=new Probe();check(!p.showLogoFileChooser(p.webView,null,params("image/png")),"null callback cannot start picker");
 System.out.println("PASS exact local document/lifecycle/busy guards");
}
static void valid(){
 for(String mime:new String[]{"image/png","image/jpeg","image/webp"}){
  Probe p=new Probe();p.mime=mime;Result r=open(p);Intent intent=p.launched;
  check(Intent.ACTION_OPEN_DOCUMENT.equals(intent.action)&&intent.categories.contains(Intent.CATEGORY_OPENABLE),"single explicit open-document intent");check("image/*".equals(intent.type),"image MIME selection");check(Arrays.equals(new String[]{"image/png","image/jpeg","image/webp"},(String[])intent.extras.get(Intent.EXTRA_MIME_TYPES)),"only three raster MIME types offered");check(Boolean.FALSE.equals(intent.extras.get(Intent.EXTRA_ALLOW_MULTIPLE)),"no multiple selection");check(intent.flags==Intent.FLAG_GRANT_READ_URI_PERMISSION&&p.request==1004,"read grant only, correct independent request code");
  check(p.showLogoFileChooser(p.webView,r,params("image/png"))&&p.starts==1&&r.calls==0,"same callback duplicate retains original owner");Result another=new Result();p.showLogoFileChooser(p.webView,another,params("image/png"));check(another.calls==1&&another.value==null&&r.calls==0&&p.starts==1,"new concurrent callback cancelled without replacing first");
  Intent data=selected("content://documents/logo");data.setClipData(new ClipData(data.getData()));p.handleLogoImageResult(-1,data);
  check(r.calls==1&&r.value.length==1&&r.value[0].equals(data.getData()),"only selected content URI returned");check(!p.documentPickerOpen&&!p.logoPickerOpen&&p.pendingLogoCallback==null&&p.typeReads==1,"ownership and MIME read bounded");p.handleLogoImageResult(-1,data);check(r.calls==1,"duplicate system result cannot complete twice");
 }
 System.out.println("PASS PNG/JPEG/WEBP selected URI, intent, duplicates, exactly-once completion");
}
static void invalid(){
 for(String reason:new String[]{"cancel","null-data","null-uri","file","https","missing-authority","fragment","long-uri","multiple","clip-mismatch","wrong-mime","svg","resolver-denied","stale-view","foreign-page","finishing","activity-destroyed","destroyed"}){
  Probe p=new Probe();Result r=open(p);Intent data=selected("content://documents/logo");int result=-1;
  switch(reason){case "cancel":result=0;break;case "null-data":data=null;break;case "null-uri":data=selected(null);break;case "file":data=selected("file:///sdcard/logo.png");break;case "https":data=selected("https://example.com/logo.png");break;case "missing-authority":data=selected("content:///logo.png");break;case "fragment":data=selected("content://documents/logo#x");break;case "long-uri":data=selected("content://documents/"+"x".repeat(8192));break;case "multiple":data.setClipData(new ClipData(data.getData(),Uri.parse("content://documents/second")));break;case "clip-mismatch":data.setClipData(new ClipData(Uri.parse("content://documents/other")));break;case "wrong-mime":p.mime="application/pdf";break;case "svg":p.mime="image/svg+xml";break;case "resolver-denied":p.resolverFailure=true;break;case "stale-view":p.webView=new WebView();break;case "foreign-page":p.webView.url="file:///android_asset/other.html";break;case "finishing":p.finishing=true;break;case "activity-destroyed":p.activityDestroyed=true;break;case "destroyed":p.destroyed=true;break;}
  p.handleLogoImageResult(result,data);assertCancelled(p,r);
 }
 System.out.println("PASS cancellation, invalid/foreign URI, multiple input, MIME and stale document failures");
}
static void lifecycle(){
 Probe p=new Probe();Result r=open(p);p.navigate(new WebView());check(r.calls==0,"other WebView navigation ignored");p.navigate(p.webView);check(r.calls==1&&r.value==null,"same-document reload/navigation cancels old callback");check(p.documentPickerOpen&&p.logoPickerOpen,"old system picker remains busy after document cancellation");Result later=new Result();p.showLogoFileChooser(p.webView,later,params("image/png"));check(later.calls==1&&later.value==null&&p.starts==1,"no new picker races the old result");p.handleLogoImageResult(-1,selected("content://documents/logo"));assertCancelled(p,r);
 p=new Probe();r=open(p);p.destroy();assertCancelled(p,r);p.destroy();check(r.calls==1,"repeated destroy still completes once");
 p=new Probe();p.launchFailure=true;r=new Result();p.showLogoFileChooser(p.webView,r,params("image/png"));assertCancelled(p,r);
 p=new Probe();r=open(p);r.fail=true;p.handleLogoImageResult(-1,selected("content://documents/logo"));check(r.calls==1&&!p.documentPickerOpen&&!p.logoPickerOpen&&p.pendingLogoCallback==null,"callback runtime failure still releases ownership");
 System.out.println("PASS navigation, destroy, failed launch and destroyed callback cleanup");
}
public static void main(String[] args){accepts();guards();valid();invalid();lifecycle();System.out.println("PASS actual MainActivity image chooser: "+checks+" assertions; no device, storage permissions, camera, network or salon data");}
}
'''
with tempfile.TemporaryDirectory(prefix='salon-native-logo-picker-') as directory:
    root = Path(directory)
    for name, content in stubs.items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding='utf-8')
    classes = root / 'classes'
    subprocess.run([str(java / 'javac.exe'), '-encoding', 'UTF-8', '-d', str(classes),
                    *map(str, root.rglob('*.java'))], check=True, timeout=30)
    subprocess.run([str(java / 'java.exe'), '-cp', str(classes), 'ro.salon.agenda.test.NativeLogoPickerTest'], check=True, timeout=10)
