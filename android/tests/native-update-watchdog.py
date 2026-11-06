"""Run production AppUpdater with Android service and blocking HTTP adapters.

Uses the official AOSP JSON classes, real executors and real watchdog scheduling.
One case waits for the production 15-second limit; race cases use a shorter
package-only deadline. No server, APK download, credentials or Android device.
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
assert (json_classes / 'org/json/JSONObject.class').exists(), 'Official AOSP JSON classes required'
# Reuse only the existing test's service-adapter dictionary, without running its
# network tests or subprocesses. The actual updater and policy are compiled below.
fixture_file = base / 'tests/native-update-network.py'
tree = ast.parse(fixture_file.read_text(encoding='utf-8'))
assignment = next(n for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'stubs' for t in n.targets))
callback = re.search(r'    private void deliverAppUpdateResult\([^\n]+\) \{\n.*?\n    \}', (source / 'MainActivity.java').read_text(encoding='utf-8'), re.S)
namespace = {'callback': callback}
exec(compile(ast.Module(body=[assignment], type_ignores=[]), str(fixture_file), 'exec'), namespace)
stubs = namespace['stubs']
del stubs['ro/salon/agenda/test/NativeUpdateNetworkTest.java']
stubs['ro/salon/agenda/test/NativeUpdateWatchdogTest.java'] = r'''package ro.salon.agenda.test;
import java.io.*;import java.net.*;import java.nio.charset.StandardCharsets;import java.util.*;import java.util.concurrent.*;import java.lang.reflect.*;import org.json.JSONObject;
public final class NativeUpdateWatchdogTest {
static int checks;static volatile Fake next;static final List<Fake> opened=Collections.synchronizedList(new ArrayList<>());
static void check(boolean ok,String message){checks++;if(!ok)throw new AssertionError(message);}
static String metadata(int code,String version){return "{\"versionCode\":"+code+",\"versionName\":\""+version+"\",\"minSdk\":26,\"size\":123,\"sha256\":\""+"a".repeat(64)+"\",\"apkUrl\":\"https://github.com/caiuspoputa-debug/agenda-salon/releases/download/v"+version+"/Agenda-Salon-"+version+".apk\"}";}
static void awaitIgnoringInterrupt(CountDownLatch latch){while(latch.getCount()!=0)try{latch.await();}catch(InterruptedException ignored){}}
static final class Fake extends HttpURLConnection {
 final byte[] bytes;final CountDownLatch entered=new CountDownLatch(1),gate=new CountDownLatch(1),closeGate=new CountDownLatch(1);final boolean blockResponse,blockRead,blockClose;final int code;boolean networkError,blockStreamClose;IOException failure;
 Fake(String body,int code,boolean response,boolean read,boolean close)throws Exception{super(new URL(UpdatePolicy.METADATA_URL));bytes=body.getBytes(StandardCharsets.UTF_8);this.code=code;blockResponse=response;blockRead=read;blockClose=close;}
 public void connect(){}public boolean usingProxy(){return false;}
 public void disconnect(){if(blockClose)awaitIgnoringInterrupt(closeGate);}
 public int getResponseCode()throws IOException{if(blockResponse){entered.countDown();awaitIgnoringInterrupt(gate);}if(failure!=null)throw failure;if(networkError)throw new IOException("fixture unavailable");return code;}
 public long getContentLengthLong(){return bytes.length;}
 public InputStream getInputStream(){return new ByteArrayInputStream(bytes){boolean first=true;public synchronized int read(byte[] b,int o,int n){if(first&&blockRead){first=false;entered.countDown();awaitIgnoringInterrupt(gate);}return super.read(b,o,n);}public void close(){if(blockStreamClose)awaitIgnoringInterrupt(closeGate);}};}
 void release(){gate.countDown();closeGate.countDown();}
 }
static final class Probe implements AutoCloseable {
 final android.app.Activity activity=new android.app.Activity();final BlockingQueue<String> events=new LinkedBlockingQueue<>();final List<String> all=Collections.synchronizedList(new ArrayList<>());final AppUpdater updater;
 Probe(long timeout){updater=new AppUpdater(activity,(id,value)->{String event=id+"|"+value.toString();all.add(event);events.add(event);},timeout);}
 Probe(){updater=new AppUpdater(activity,(id,value)->{String event=id+"|"+value.toString();all.add(event);events.add(event);});}
 String event(String id,String status,long timeout)throws Exception{String event=events.poll(timeout,TimeUnit.MILLISECONDS);check(event!=null,"callback deadline for "+id);check(event.startsWith(id+"|"),"request id preserved: "+event);JSONObject json=new JSONObject(event.substring(event.indexOf('|')+1));check(status.equals(json.getString("status")),"expected "+status+": "+event);return event;}
 void noExtra()throws Exception{check(events.poll(60,TimeUnit.MILLISECONDS)==null,"no duplicate/late callback");}
 void waitWorker()throws Exception{ExecutorService pool=(ExecutorService)field(updater,"metadataExecutor");long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(2);while(((ThreadPoolExecutor)pool).getActiveCount()!=0&&System.nanoTime()<until)Thread.sleep(2);check(((ThreadPoolExecutor)pool).getActiveCount()==0,"metadata worker returned");}
 public void close(){updater.destroy();activity.ui.shutdownNow();}
 }
static Object field(Object object,String name)throws Exception{Field field=AppUpdater.class.getDeclaredField(name);field.setAccessible(true);return field.get(object);}
static Fake fake(String body,int code,boolean response,boolean read,boolean close)throws Exception{Fake f=new Fake(body,code,response,read,close);next=f;return f;}
static void rejected(String url)throws Exception{boolean denied=false;try{UpdatePolicy.networkUrl(url);}catch(Exception expected){denied=true;}check(denied,"deny metadata URL "+url);}
static void basic(String mode)throws Exception{
 try(Probe p=new Probe(600)){
  Fake f=fake(mode.equals("malformed")?"{broken":metadata(40,"1.0.40"),mode.equals("redirect")?302:200,false,false,false);f.networkError=mode.equals("network");
  if(mode.equals("current"))p.activity.pm.installed.versionCode=40;
  p.updater.check("check-"+mode);String status=mode.equals("current")?"current":mode.equals("available")?"available":"error";p.event("check-"+mode,status,1000);p.waitWorker();p.noExtra();
  check(!f.getUseCaches(),"metadata HTTP cache disabled");check("no-cache".equals(f.getRequestProperty("Cache-Control")),"metadata cache-control");check(!f.getInstanceFollowRedirects(),"metadata redirects disabled");
  check(f.getConnectTimeout()<=8000&&f.getReadTimeout()<=8000,"short network timeouts");check((field(p.updater,"available")!=null)==mode.equals("available"),"only successful newer metadata installable");
 }
 System.out.println("PASS "+mode);
}
static void timeoutAndRetry(boolean read,boolean blockedClose)throws Exception{
 try(Probe p=new Probe(160)){
  Fake old=fake(metadata(98,"1.0.98"),200,!read,read,blockedClose);long began=System.nanoTime();p.updater.check("old");check(old.entered.await(500,TimeUnit.MILLISECONDS),"blocking transport entered");
  p.event("old","error",900);check(TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-began)<900,"watchdog independent of blocked HTTP");check(field(p.updater,"available")==null,"timeout cannot authorize install");
  Fake fresh=fake(metadata(99,"1.0.99"),200,false,false,false);p.updater.check("occupied-retry");p.event("occupied-retry","error",500);check(!opened.contains(fresh),"retry never queued behind blocked HTTP");
  ThreadPoolExecutor pool=(ThreadPoolExecutor)field(p.updater,"metadataExecutor");check(pool.getMaximumPoolSize()==1&&pool.getQueue().size()==0,"bounded metadata threads and no queued retries");
  check(!((java.util.concurrent.atomic.AtomicBoolean)field(p.updater,"busy")).get(),"timeout and rejected retry release logical busy");
  old.release();p.waitWorker();p.noExtra();check(field(p.updater,"available")==null,"late old metadata ignored");
  p.updater.check("fresh-retry");p.event("fresh-retry","available",1000);p.waitWorker();p.noExtra();Object available=field(p.updater,"available");Field name=available.getClass().getDeclaredField("name");name.setAccessible(true);check("1.0.99".equals(name.get(available)),"fresh successful metadata retained");
  check(p.all.size()==3,"exactly one terminal result per accepted request");
 }
 System.out.println("PASS timeout retry and late result read="+read+" blockedClose="+blockedClose);
}
static void destroyCase()throws Exception{
 Probe p=new Probe(100);Fake f=fake(metadata(99,"1.0.99"),200,true,false,false);p.updater.check("destroyed");check(f.entered.await(500,TimeUnit.MILLISECONDS),"destroy transport entered");long start=System.nanoTime();p.updater.destroy();check(TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-start)<200,"destroy returns without waiting for HTTP");f.release();p.waitWorker();p.noExtra();check(field(p.updater,"available")==null,"destroyed metadata never published");p.close();System.out.println("PASS destroy cancels callback");
}
static void productionDeadline()throws Exception{
 try(Probe p=new Probe()){
  check(AppUpdater.CHECK_TIMEOUT_MILLIS==15000,"production limit is 15 seconds");Fake f=fake(metadata(99,"1.0.99"),200,true,false,true);long began=System.nanoTime();p.updater.check("production-deadline");check(f.entered.await(500,TimeUnit.MILLISECONDS),"production blocking transport entered");
  try{p.event("production-deadline","error",16500);long elapsed=TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-began);check(elapsed>=14500&&elapsed<16500,"real watchdog result within 15-second scheduling tolerance: "+elapsed);System.out.println("PASS production 15-second watchdog elapsedMs="+elapsed);}finally{f.release();}p.waitWorker();p.noExtra();
 }
}
static void completeBodyBlockedCleanup(boolean streamClose)throws Exception{
 try(Probe p=new Probe(700)){
  p.activity.pm.installed.versionCode=40;Fake f=fake(metadata(40,"1.0.40"),200,false,false,!streamClose);f.blockStreamClose=streamClose;long start=System.nanoTime();
  try{p.updater.check("complete-body");p.event("complete-body","current",500);check(TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-start)<500,"complete valid body succeeds without waiting for cleanup");p.waitWorker();check(((ThreadPoolExecutor)field(p.updater,"disconnectExecutor")).getMaximumPoolSize()==1,"cleanup threads bounded");}finally{f.release();}p.noExtra();
 }
 System.out.println("PASS full valid metadata with blocked "+(streamClose?"InputStream.close":"disconnect")+" returns current promptly");
}
static void safeDiagnostic(String code)throws Exception{
 try(Probe p=new Probe(700)){
  Fake f=fake(metadata(40,"1.0.40"),code.equals("http")?503:200,false,false,false);
  String secret="https://private.invalid/?token=do-not-expose";
  if(code.equals("tls"))f.failure=new javax.net.ssl.SSLHandshakeException(secret);else if(code.equals("dns"))f.failure=new UnknownHostException(secret);else if(code.equals("network_timeout"))f.failure=new SocketTimeoutException(secret);
  p.updater.check("diagnostic-"+code);String event=p.event("diagnostic-"+code,"error",1000);JSONObject value=new JSONObject(event.substring(event.indexOf('|')+1));check(code.equals(value.getString("code")),"safe diagnostic code "+code);check("connecting".equals(value.getString("phase")),"network phase retained");check(!event.contains("private.invalid")&&!event.contains("do-not-expose"),"raw exception URLs and credentials redacted");if(code.equals("http"))check(value.getString("message").contains("503"),"HTTP status helps phone diagnosis");p.waitWorker();p.noExtra();
 }
 System.out.println("PASS safe "+code+" diagnostic without raw errors");
}
public static void main(String[] args)throws Exception{
 URL.setURLStreamHandlerFactory(protocol->"https".equals(protocol)?new URLStreamHandler(){protected URLConnection openConnection(URL url){Fake f=next;if(f==null)throw new AssertionError("No HTTP fixture");check(UpdatePolicy.METADATA_URL.equals(url.toString()),"metadata exact direct endpoint");opened.add(f);return f;}}:null);
 check(UpdatePolicy.networkUrl(UpdatePolicy.METADATA_URL)!=null,"exact static Pages metadata accepted");
 for(String url:new String[]{UpdatePolicy.METADATA_URL+"?x=1",UpdatePolicy.METADATA_URL+"#x","https://caiuspoputa-debug.github.io/agenda-salon/other.json","https://caiuspoputa-debug.github.io/other/update.json","http://caiuspoputa-debug.github.io/agenda-salon/update.json","https://caiuspoputa-debug.github.io:444/agenda-salon/update.json","https://user@caiuspoputa-debug.github.io/agenda-salon/update.json","https://caiuspoputa-debug.github.io/agenda-salon/%61ndroid-update.json"})rejected(url);
 for(String mode:new String[]{"available","current","malformed","network","redirect"})basic(mode);
 timeoutAndRetry(false,false);timeoutAndRetry(true,false);timeoutAndRetry(true,true);destroyCase();completeBodyBlockedCleanup(false);completeBodyBlockedCleanup(true);for(String code:new String[]{"tls","dns","network_timeout","http"})safeDiagnostic(code);productionDeadline();
 System.out.println("PASS native watchdog 16 scenarios; "+checks+" assertions; no actual Android device or real network");
}
}
'''
with tempfile.TemporaryDirectory(prefix='salon-native-update-watchdog-') as directory:
    root = Path(directory)
    for name, content in stubs.items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding='utf-8')
    classes = root / 'classes'
    sources = [str(p) for p in root.rglob('*.java')] + [str(source / name) for name in ('AppUpdater.java', 'UpdatePolicy.java', 'UpdateResultMailbox.java')]
    subprocess.run([str(java / 'javac.exe'), '-encoding', 'UTF-8', '-cp', str(json_classes), '-d', str(classes), *sources], check=True, timeout=30)
    subprocess.run([str(java / 'java.exe'), '-cp', str(classes) + ';' + str(json_classes), 'ro.salon.agenda.test.NativeUpdateWatchdogTest'], check=True, timeout=35)
