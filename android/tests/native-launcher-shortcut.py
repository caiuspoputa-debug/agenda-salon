"""User-named pinned shortcut; isolated Android API adapters, no actual launcher."""
from pathlib import Path
import subprocess,tempfile
base=Path(__file__).resolve().parents[1]
source=base/'app/src/main/java/ro/caiuspoputa/agendasalon'
java=Path('C:/Program Files/Android/Android Studio/jbr/bin')
stubs={
'android/app/Activity.java':'''package android.app;public class Activity {public android.content.pm.ShortcutManager manager=new android.content.pm.ShortcutManager();public <T>T getSystemService(Class<T> c){return c.cast(manager);}}''',
'android/content/ComponentName.java':'''package android.content;public class ComponentName {public final Class<?> target;public ComponentName(android.app.Activity a,Class<?> t){target=t;}}''',
'android/content/Intent.java':'''package android.content;public class Intent {public static final String ACTION_VIEW="VIEW";public final Class<?> target;public String action;public Intent(android.app.Activity a,Class<?> t){target=t;}public Intent setAction(String a){action=a;return this;}}''',
'android/graphics/drawable/Icon.java':'''package android.graphics.drawable;public class Icon {public int resource;public static Icon createWithResource(android.app.Activity a,int r){Icon i=new Icon();i.resource=r;return i;}}''',
'android/content/pm/ShortcutInfo.java':'''package android.content.pm;public class ShortcutInfo {public String id,label,longLabel;public android.content.Intent intent;public android.content.ComponentName activity;public android.graphics.drawable.Icon icon;public String getId(){return id;}public CharSequence getShortLabel(){return label;}
public static class Builder {ShortcutInfo s=new ShortcutInfo();public Builder(android.app.Activity a,String id){s.id=id;}public Builder setActivity(android.content.ComponentName a){s.activity=a;return this;}public Builder setShortLabel(String l){s.label=l;return this;}public Builder setLongLabel(String l){s.longLabel=l;return this;}public Builder setIcon(android.graphics.drawable.Icon i){s.icon=i;return this;}public Builder setIntent(android.content.Intent i){s.intent=i;return this;}public ShortcutInfo build(){return s;}}}''',
'android/content/pm/ShortcutManager.java':'''package android.content.pm;public class ShortcutManager {public java.util.List<ShortcutInfo> pinned=new java.util.ArrayList<>();public ShortcutInfo last;public boolean supported=true,accept=true,update=true,fail;public int requests,updates;
public java.util.List<ShortcutInfo> getPinnedShortcuts(){if(fail)throw new IllegalStateException();return pinned;}public boolean isRequestPinShortcutSupported(){return supported;}
public boolean requestPinShortcut(ShortcutInfo s,Object callback){requests++;last=s;return accept;}public boolean updateShortcuts(java.util.List<ShortcutInfo> values){updates++;last=values.get(0);return update;}}''',
'ro/caiuspoputa/agendasalon/MainActivity.java':'package ro.caiuspoputa.agendasalon;public class MainActivity {}',
'ro/caiuspoputa/agendasalon/R.java':'package ro.caiuspoputa.agendasalon;public final class R {public static class mipmap {public static final int ic_launcher=7;}}',
'ro/caiuspoputa/agendasalon/ShortcutTest.java':r'''package ro.caiuspoputa.agendasalon;public class ShortcutTest {
static int n;static void check(boolean yes){n++;if(!yes)throw new AssertionError("check "+n);}
public static void main(String[] args){android.app.Activity a=new android.app.Activity();
LauncherShortcut.syncExisting(a,"Salon Narcisa");check(a.manager.requests==0&&a.manager.updates==0);
check(LauncherShortcut.request(a,"  Salon Narcisa  ").contains("Confirmă"));check(a.manager.requests==1&&a.manager.updates==0);check(a.manager.last.label.equals("Salon Narcisa"));check(a.manager.last.longLabel.equals("Salon Narcisa"));check(a.manager.last.id.equals("salon-personal-home"));check(a.manager.last.intent.target==MainActivity.class&&a.manager.last.activity.target==MainActivity.class);check(a.manager.last.intent.action.equals("VIEW"));check(a.manager.last.icon.resource==R.mipmap.ic_launcher);
// A successful request is not a confirmed pin; only a pinned id can be updated.
check(a.manager.pinned.isEmpty());a.manager.pinned.add(a.manager.last);LauncherShortcut.syncExisting(a,"Salon Narcisa");check(a.manager.updates==0);LauncherShortcut.syncExisting(a,"Nume sincronizat");check(a.manager.requests==1&&a.manager.updates==1&&a.manager.last.label.equals("Nume sincronizat"));check(LauncherShortcut.request(a,"Narcisa Studio").contains("actualizat"));check(a.manager.requests==1&&a.manager.updates==2&&a.manager.last.label.equals("Narcisa Studio"));a.manager.update=false;check(LauncherShortcut.request(a,"Alt nume").contains("nu a putut"));
for(String bad:new String[]{null,"","   ","x".repeat(61),"Sal\non","Nume\u202Eascuns","Sal\0on"}){int before=a.manager.requests+a.manager.updates;check(LauncherShortcut.request(a,bad).contains("1–60"));check(before==a.manager.requests+a.manager.updates);}
a.manager.pinned.clear();a.manager.supported=false;check(LauncherShortcut.request(a,"Narcisa").contains("nu permite"));a.manager.supported=true;a.manager.accept=false;check(LauncherShortcut.request(a,"Narcisa").contains("nu a putut"));a.manager.fail=true;check(LauncherShortcut.request(a,"Narcisa").contains("agenda sunt păstrate"));a.manager=null;check(LauncherShortcut.request(a,"Narcisa").contains("nu permite"));
System.out.println("PASS launcher shortcut: "+n+" assertions; stable id, named icon, explicit system consent, rename, unsupported/denied and invalid labels.");}}
'''}
main=(source/'MainActivity.java').read_text(encoding='utf-8')
method=main.split('@JavascriptInterface public void nameHomeShortcut',1)[1].split('@JavascriptInterface',1)[0]
assert 'if (!trustedPage()) return;' in method and 'runOnUiThread' in method
with tempfile.TemporaryDirectory(prefix='salon-shortcut-test-') as directory:
    root=Path(directory)
    for name,text in stubs.items():
        p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text,encoding='utf-8')
    subprocess.run([str(java/'javac.exe'),'-encoding','UTF-8','-d',str(root/'classes'),*[str(p) for p in root.rglob('*.java')],str(source/'LauncherShortcut.java')],check=True,timeout=30)
    subprocess.run([str(java/'java.exe'),'-cp',str(root/'classes'),'ro.caiuspoputa.agendasalon.ShortcutTest'],check=True,timeout=10)
