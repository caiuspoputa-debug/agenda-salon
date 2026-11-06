"""Actual native updater mailbox survives dropped UI push, without a device.

Compiles production classes with official AOSP JSON and Android service adapters.
All HTTPS is local fake transport; no real accounts, APK or business data.
"""
from pathlib import Path
import ast
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
fixture_file = base / 'tests/native-update-network.py'
tree = ast.parse(fixture_file.read_text(encoding='utf-8'))
assignment = next(n for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'stubs' for t in n.targets))
callback = re.search(r'    private void deliverAppUpdateResult\([^\n]+\) \{\n.*?\n    \}', (source / 'MainActivity.java').read_text(encoding='utf-8'), re.S)
namespace = {'callback': callback}
exec(compile(ast.Module(body=[assignment], type_ignores=[]), str(fixture_file), 'exec'), namespace)
stubs = namespace['stubs']
del stubs['ro/salon/agenda/test/NativeUpdateNetworkTest.java']
stubs['ro/salon/agenda/test/NativeUpdateMailboxTest.java'] = r'''package ro.salon.agenda.test;
import org.json.JSONObject;import java.io.*;import java.net.*;import java.nio.charset.StandardCharsets;import java.lang.reflect.*;import java.util.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;
public final class NativeUpdateMailboxTest {
static int checks;static boolean stalled;static CountDownLatch entered,release;
static void check(boolean value,String message){checks++;if(!value)throw new AssertionError(message);}
static JSONObject value(String status,String message)throws Exception{return new JSONObject().put("status",status).put("message",message);}
static JSONObject read(UpdateResultMailbox mailbox,String id)throws Exception{return new JSONObject(mailbox.read(id));}
static String stage(UpdateResultMailbox mailbox,String id)throws Exception{return read(mailbox,id).getString("stage");}
static int count(UpdateResultMailbox mailbox)throws Exception{Field f=UpdateResultMailbox.class.getDeclaredField("entries");f.setAccessible(true);return ((Map<?,?>)f.get(mailbox)).size();}
static void unit()throws Exception {
 UpdateResultMailbox mailbox=new UpdateResultMailbox();
 for(String id:new String[]{null,"","id/escape","x".repeat(101),"bad\nline"}){mailbox.queued(id);mailbox.started(id);mailbox.publish(id,value("error","safe"));check(mailbox.read(id).isEmpty(),"invalid id rejected");}
 for(int i=0;i<100;i++)check(mailbox.read("unknown-"+i).isEmpty(),"unknown lookup empty");check(count(mailbox)==0,"lookup never allocates");
 mailbox.queued("one");check("queued".equals(stage(mailbox,"one")),"queued visible");long queuedRevision=read(mailbox,"one").getLong("revision");
 mailbox.started("one");check("started".equals(stage(mailbox,"one")),"started visible");check(read(mailbox,"one").getLong("revision")>queuedRevision,"revision increases");mailbox.queued("one");check("started".equals(stage(mailbox,"one")),"queued cannot downgrade started");
 JSONObject progress=value("downloading","before");mailbox.publish("one",progress);String snapshot=mailbox.read("one");progress.put("message","mutated");check(snapshot.equals(mailbox.read("one")),"defensive JSON snapshot");check("progress".equals(stage(mailbox,"one")),"downloading is not terminal");mailbox.started("one");check(snapshot.equals(mailbox.read("one")),"started cannot replace progress");
 mailbox.publish("one",value("installer","confirmed"));String terminal=mailbox.read("one");check("terminal".equals(stage(mailbox,"one")),"installer terminal");mailbox.publish("one",value("error","late"));mailbox.publish("one",value("downloading","late"));mailbox.started("one");mailbox.queued("one");check(terminal.equals(mailbox.read("one")),"first terminal wins against all late stages");
 mailbox.publish("two",value("current","other"));check("two".equals(read(mailbox,"two").getString("requestId")),"request id retained");check(!mailbox.read("two").equals(terminal),"request results isolated");
 mailbox.publish("bad-payload",value("unknown","ignored"));check(mailbox.read("bad-payload").isEmpty(),"unknown result status ignored");
 for(int i=0;i<20;i++)mailbox.queued("bounded-"+i);check(count(mailbox)==8,"only eight requests retained");check(mailbox.read("bounded-0").isEmpty(),"old requests evicted");check(!mailbox.read("bounded-19").isEmpty(),"new request retained");
 mailbox.publish("oversized",value("available","x".repeat(20000)));check("error".equals(read(mailbox,"oversized").getJSONObject("result").getString("status")),"oversized response replaced with bounded error");check(mailbox.read("oversized").length()<500,"stored fallback remains bounded");
 mailbox.close();mailbox.queued("after-close");mailbox.publish("after-close",value("current","ignored"));check(count(mailbox)==0&&mailbox.read("after-close").isEmpty(),"close clears and blocks further writes");
 System.out.println("PASS mailbox ids/stages/immutable terminal/defensive snapshot/bounds/close");
}
static final class DroppedUI extends android.app.Activity {
 final AtomicInteger attempted=new AtomicInteger();final List<Runnable> queued=Collections.synchronizedList(new ArrayList<>());
 @Override public void runOnUiThread(Runnable runnable){attempted.incrementAndGet();queued.add(runnable);}
}
static String waitTerminal(AppUpdater updater,String id)throws Exception{
 long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(2);String raw="";
 while(System.nanoTime()<until){raw=updater.resultFor(id);if(!raw.isEmpty()&&"terminal".equals(new JSONObject(raw).getString("stage")))return raw;Thread.sleep(2);}
 throw new AssertionError("No retained terminal result: "+raw);
}
static void droppedPush(boolean timeout)throws Exception {
 stalled=timeout;entered=new CountDownLatch(1);release=new CountDownLatch(1);DroppedUI activity=new DroppedUI();AtomicInteger listeners=new AtomicInteger();AppUpdater updater=new AppUpdater(activity,(id,result)->listeners.incrementAndGet(),180);
 try{
  String id=timeout?"timeout-request":"success-request";updater.queueResult(id);check("queued".equals(new JSONObject(updater.resultFor(id)).getString("stage")),"bridge queue evidence retained");
  updater.check(id);if(timeout)check(entered.await(500,TimeUnit.MILLISECONDS),"stalled native transport entered");
  final String[] result={null};Thread bridge=new Thread(()->{try{result[0]=waitTerminal(updater,id);}catch(Exception ex){throw new RuntimeException(ex);}},"fixture-JavaBridge-thread");bridge.start();bridge.join(2200);
  check(!bridge.isAlive()&&result[0]!=null,"getter returns on bridge thread without UI");JSONObject envelope=new JSONObject(result[0]);check(id.equals(envelope.getString("requestId")),"getter returns exact request");check((timeout?"error":"available").equals(envelope.getJSONObject("result").getString("status")),"native result retained despite dropped push");
  check(listeners.get()==0,"UI callback deliberately never delivered");long deliveryUntil=System.nanoTime()+TimeUnit.SECONDS.toNanos(1);while(activity.attempted.get()==0&&System.nanoTime()<deliveryUntil)Thread.sleep(2);check(activity.attempted.get()==1,"one terminal UI delivery attempted");
  updater.rejectResult(id,"late guard rejection");check(result[0].equals(updater.resultFor(id)),"late rejection cannot replace terminal");check(activity.attempted.get()==1,"late terminal cannot create contradictory UI push");
  updater.queueResult("untrusted");updater.rejectResult("untrusted","Pagina aplicației nu este disponibilă.");JSONObject rejected=new JSONObject(updater.resultFor("untrusted"));check("error".equals(rejected.getJSONObject("result").getString("status")),"explicit guard rejection retained");check("terminal".equals(rejected.getString("stage")),"rejection terminal");
  check(updater.resultFor("unknown").isEmpty(),"updater unknown id does not allocate");
  updater.destroy();release.countDown();check(updater.resultFor(id).isEmpty(),"destroy clears retained result");for(Runnable callback:activity.queued)callback.run();check(listeners.get()==0,"queued callback suppressed after destroy");
 }finally{release.countDown();updater.destroy();activity.ui.shutdownNow();}
 System.out.println("PASS dropped UI push, native "+(timeout?"watchdog error":"available")+", bridge-thread getter, rejection, destroy");
}
static void concurrency()throws Exception{
 UpdateResultMailbox mailbox=new UpdateResultMailbox();ExecutorService pool=Executors.newFixedThreadPool(4);CountDownLatch done=new CountDownLatch(4);AtomicReference<Throwable> failure=new AtomicReference<>();
 for(int n=0;n<4;n++){final int thread=n;pool.execute(()->{try{for(int i=0;i<100;i++){String id="parallel-"+(i%8);mailbox.queued(id);mailbox.started(id);mailbox.publish(id,value("current","public-"+thread));String raw=mailbox.read(id);if(!raw.isEmpty()){JSONObject parsed=new JSONObject(raw);if(!id.equals(parsed.getString("requestId")))throw new AssertionError("Mixed request snapshot");}}}catch(Throwable ex){failure.compareAndSet(null,ex);}finally{done.countDown();}});}
 check(done.await(2,TimeUnit.SECONDS),"parallel operations complete without UI or blocking I/O");pool.shutdownNow();check(failure.get()==null,"parallel operations have no hidden failure: "+failure.get());check(count(mailbox)==8,"parallel store stays bounded");for(int i=0;i<8;i++)check("terminal".equals(stage(mailbox,"parallel-"+i)),"parallel terminal retained");System.out.println("PASS concurrent mailbox writers/readers");
}
public static void main(String[] args)throws Exception{
 URL.setURLStreamHandlerFactory(protocol->"https".equals(protocol)?new URLStreamHandler(){protected URLConnection openConnection(URL url){return new HttpURLConnection(url){public void connect(){}public boolean usingProxy(){return false;}public void disconnect(){}public int getResponseCode(){if(stalled){entered.countDown();while(release.getCount()!=0)try{release.await();}catch(InterruptedException ignored){}}return 200;}public long getContentLengthLong(){return -1;}public InputStream getInputStream(){String body="{\"versionCode\":999,\"versionName\":\"1.0.999\",\"minSdk\":26,\"size\":123,\"sha256\":\""+"a".repeat(64)+"\",\"apkUrl\":\"https://github.com/caiuspoputa-debug/agenda-salon/releases/download/v1.0.999/Agenda-Salon-1.0.999.apk\"}";return new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8));}};}}:null);
 unit();droppedPush(false);droppedPush(true);concurrency();System.out.println("PASS production update mailbox: "+checks+" assertions; no real network or Android device");
}
}
'''
with tempfile.TemporaryDirectory(prefix='salon-native-update-mailbox-') as directory:
    root = Path(directory)
    for name, content in stubs.items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding='utf-8')
    classes = root / 'classes'
    sources = [str(p) for p in root.rglob('*.java')] + [str(source / name) for name in ('AppUpdater.java', 'UpdatePolicy.java', 'UpdateResultMailbox.java')]
    subprocess.run([str(java / 'javac.exe'), '-encoding', 'UTF-8', '-cp', str(json_classes), '-d', str(classes), *sources], check=True, timeout=30)
    subprocess.run([str(java / 'java.exe'), '-cp', str(classes) + ';' + str(json_classes), 'ro.salon.agenda.test.NativeUpdateMailboxTest'], check=True, timeout=10)
