"""Execute production migration methods with durable preference/service adapters.
Synthetic fixtures only. No phone, real activation secret, HA or network access.
"""
from pathlib import Path
import re
import subprocess
import tempfile
from native_update_test_support import json_runtime

BASE = Path(__file__).resolve().parents[1]
SOURCE = (BASE/'app/src/main/java/ro/caiuspoputa/agendasalon/MainActivity.java').read_text(encoding='utf-8')
JAVA = Path('C:/Program Files/Android/Android Studio/jbr/bin')
JSON = json_runtime(BASE)

def extract(pattern):
    found = re.search(pattern, SOURCE, re.M|re.S)
    assert found, pattern
    return found.group(0)

methods = '\n'.join(extract(r'^    private (?:static )?[^\n]+\b'+n+r'\([^\n]*\) \{\n.*?^    \}') for n in ('secureAssetHost','isHome','isAssetRequest','isLegacyHome','trustedPage','originMigrationFailed'))
bridge = extract(r'^    public final class OriginPreferencesMigration \{\n.*?^    \}')
constants = '\n'.join(extract(r'^    private static final String '+n+r' = [^\n]+') for n in ('ASSET_HOST','HOME','LEGACY_HOME','ORIGIN_PREFS'))
assert 'app_snapshot' not in bridge and 'database' not in bridge and 'ActivationStore' not in bridge
assert 'webView.loadUrl(originCaptured || originComplete ? HOME : LEGACY_HOME)' in SOURCE

stubs = {
'android/net/Uri.java': '''package android.net;public class Uri {final String raw;final java.net.URI uri;private Uri(String s){raw=s;uri=java.net.URI.create(s);}public static Uri parse(String s){return new Uri(s);}public String getScheme(){return uri.getScheme();}public String getHost(){return uri.getHost();}public String getUserInfo(){return uri.getUserInfo();}public int getPort(){return uri.getPort();}public String getPath(){return uri.getPath();}public String getQuery(){return uri.getQuery();}public String getFragment(){return uri.getFragment();}public String toString(){return raw;}}''',
'MigrationTest.java': '''import android.net.Uri;import org.json.JSONObject;import java.io.IOException;import java.util.*;
@interface JavascriptInterface {} class Context {static final int MODE_PRIVATE=0;}
public class MigrationTest {
''' + constants + '\n' + methods + '\n' + bridge + '''
static int checks;boolean destroyed,originCaptured,originComplete;String capturedUpdatePreferences;Prefs prefs=new Prefs();Web webView=new Web();List<String> events=new ArrayList<>();
final class Web {String url=LEGACY_HOME;String getUrl(){return url;}void loadUrl(String next){events.add("load:"+next);url=next;}void removeJavascriptInterface(String name){events.add("remove:"+name);}void evaluateJavascript(String script,Object unused){events.add(script.contains("Failed")?"failed":"ready");}}
static final class Prefs {final Map<String,Object> values=new HashMap<>();boolean fail;int commits;Editor edit(){return new Editor();}final class Editor {Map<String,Object> pending=new HashMap<>();Editor putString(String k,String v){pending.put(k,v);return this;}Editor putBoolean(String k,boolean v){pending.put(k,v);return this;}boolean commit(){commits++;if(fail)return false;values.putAll(pending);return true;}}}
Prefs getSharedPreferences(String name,int mode){check(name.equals(ORIGIN_PREFS)&&mode==0,"private migration preferences only");return prefs;}void runOnUiThread(Runnable r){r.run();}
static void check(boolean b,String message){checks++;if(!b)throw new AssertionError(message);}
static MigrationTest capture(String raw)throws Exception {MigrationTest p=new MigrationTest();p.new OriginPreferencesMigration().captureUpdatePreferences(raw);check(p.originCaptured&&!p.originComplete,"capture not complete");check(HOME.equals(p.webView.url),"capture opens new origin");check(Objects.equals(raw,p.prefs.values.get("updatePreferences")),"exact preference saved");check(Boolean.TRUE.equals(p.prefs.values.get("captured")),"durable capture");JSONObject read=new JSONObject(p.new OriginPreferencesMigration().readCapturedPreferences());check(read.getBoolean("captured"),"captured read available");check(raw==null?read.isNull("raw"):raw.equals(read.getString("raw")),"exact nullable raw transport");return p;}
public static void main(String[] args)throws Exception {
 for(String raw:new String[]{null,"","{\\"automatic\\":false,\\"deferDay\\":\\"2026-11-08\\"}","</script><script>data only</script>"}){
  MigrationTest p=capture(raw);p.new OriginPreferencesMigration().finishUpdatePreferences();check(p.originComplete,"complete after acknowledgement");check(Boolean.TRUE.equals(p.prefs.values.get("complete")),"durable completion");check(p.events.get(p.events.size()-1).equals("ready"),"agenda starts after durable commit");int commits=p.prefs.commits;p.new OriginPreferencesMigration().finishUpdatePreferences();p.new OriginPreferencesMigration().captureUpdatePreferences("stale");check(commits==p.prefs.commits,"stale calls cannot overwrite");
 }
 MigrationTest failed=new MigrationTest();failed.prefs.fail=true;failed.new OriginPreferencesMigration().captureUpdatePreferences("saved");check(!failed.originCaptured&&!failed.originComplete,"failed capture uncommitted");check(failed.prefs.values.isEmpty()&&LEGACY_HOME.equals(failed.webView.url),"failed capture leaves original page/data");check(failed.events.equals(List.of("failed")),"visible retry after capture failure");failed.prefs.fail=false;failed.new OriginPreferencesMigration().captureUpdatePreferences("saved");check(failed.originCaptured,"capture retry succeeds");
 MigrationTest p=capture("saved");p.prefs.fail=true;p.new OriginPreferencesMigration().finishUpdatePreferences();check(!p.originComplete&&!p.prefs.values.containsKey("complete"),"failed acknowledgement not marked complete");check(p.events.get(p.events.size()-1).equals("failed"),"failed acknowledgement does not start agenda");
 MigrationTest restarted=new MigrationTest();restarted.prefs=p.prefs;restarted.originCaptured=(Boolean)p.prefs.values.get("captured");restarted.capturedUpdatePreferences=(String)p.prefs.values.get("updatePreferences");restarted.webView.url=HOME;restarted.prefs.fail=false;restarted.new OriginPreferencesMigration().finishUpdatePreferences();check(restarted.originComplete,"restart after captured step can finish without old storage");check(restarted.capturedUpdatePreferences.equals("saved"),"raw survives restart");
 for(String url:new String[]{"https://evil.invalid/",HOME+"?x=1",HOME+"#x","http://appassets.androidplatform.net/assets/index.html","https://user@appassets.androidplatform.net/assets/index.html","https://appassets.androidplatform.net:444/assets/index.html","file:///android_asset/other.html"}){
  MigrationTest q=new MigrationTest();q.webView.url=url;q.new OriginPreferencesMigration().captureUpdatePreferences("bad");check(q.prefs.commits==0,"foreign capture blocked");q.originCaptured=true;q.new OriginPreferencesMigration().finishUpdatePreferences();check(q.prefs.commits==0&&q.events.isEmpty(),"foreign completion blocked");
 }
 MigrationTest oversized=new MigrationTest();oversized.new OriginPreferencesMigration().captureUpdatePreferences("a".repeat(65537));check(oversized.prefs.values.isEmpty()&&!oversized.originCaptured,"oversized capture cannot truncate preferences");
 MigrationTest unavailable=new MigrationTest();unavailable.destroyed=true;unavailable.new OriginPreferencesMigration().captureUpdatePreferences("bad");check(unavailable.prefs.commits==0,"destroyed capture rejected");unavailable.destroyed=false;unavailable.webView=null;unavailable.new OriginPreferencesMigration().captureUpdatePreferences("bad");check(unavailable.prefs.commits==0,"missing view rejected");
 check(isHome(Uri.parse(HOME))&&!isHome(Uri.parse(LEGACY_HOME)),"normal native actions trust only local HTTPS");
 check(isAssetRequest(Uri.parse("https://appassets.androidplatform.net/assets/app.js")),"packaged asset allowed");check(!isAssetRequest(Uri.parse("https://evil.invalid/assets/app.js")),"remote asset rejected");
 System.out.println("PASS "+checks+" native origin-migration assertions; durable capture/completion, retry and trust boundaries");
}
}
'''
}
with tempfile.TemporaryDirectory(prefix='salon-origin-tests-') as directory:
    temp=Path(directory)
    for name,value in stubs.items():
        target=temp/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(value,encoding='utf-8')
    subprocess.run([str(JAVA/'javac.exe'),'-encoding','UTF-8','-cp',str(JSON),'-d',str(temp),*[str(p) for p in temp.rglob('*.java')]],check=True,timeout=30)
    subprocess.run([str(JAVA/'java.exe'),'-cp',str(temp)+';'+str(JSON),'MigrationTest'],check=True,timeout=10)
