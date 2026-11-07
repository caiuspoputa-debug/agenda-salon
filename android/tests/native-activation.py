"""Run production activation/encryption code with synthetic keys and Android service adapters.

No device, real PIN/private key, server, business database or HA store is read.
The one production public-key constant is replaced in the temporary compile only
with an ephemeral test key. Crypto uses real JCA ECDSA/AES-GCM; AndroidKeyStore and
SharedPreferences are service adapters, not hardware/device tests.
"""
from pathlib import Path
import json
import re
import subprocess
import tempfile

BASE = Path(__file__).resolve().parents[1]
SOURCE = BASE / 'app/src/main/java/ro/caiuspoputa/agendasalon'
JAVA = Path('C:/Program Files/Android/Android Studio/jbr/bin')
from native_update_test_support import json_runtime
JSON_CLASSES = json_runtime(BASE)
public_file = BASE.parent / 'salon-activation-public-key.json'
PUBLIC = json.loads(public_file.read_text(encoding='utf8')) if public_file.exists() else {'spki':'SALON_PUBLIC_KEY_PENDING','issuer':'ro.salon.agenda.test.activation.v1','audience':'ro.salon.agenda.test.activation','origin':'https://salon-activation.invalid'}
store_source = (SOURCE / 'ActivationStore.java').read_text(encoding='utf8')
main = (SOURCE / 'MainActivity.java').read_text(encoding='utf8')
activity = (SOURCE / 'ActivationActivity.java').read_text(encoding='utf8')
encrypted = (SOURCE / 'EncryptedActivationStore.java').read_text(encoding='utf8')
manifest = (BASE / 'app/src/main/AndroidManifest.xml').read_text(encoding='utf8')
assert PUBLIC['spki'] in store_source and PUBLIC['issuer'] in store_source
assert PUBLIC['audience'] in store_source and PUBLIC['origin'] in store_source
assert 'setSaveEnabled(false)' in activity and 'TYPE_NUMBER_VARIATION_PASSWORD' in activity
assert 'ImageView' not in activity and 'salon-logo.png' not in activity
assert 'setImageResource' not in activity and 'createFromStream' not in activity
assert 'pending.cancel()' in activity and 'work.cancel(true)' in activity
assert 'handler.postDelayed(deadline, ActivationStore.REQUEST_TIMEOUT_MILLIS)' in activity
assert 'new SynchronousQueue<Runnable>()' in activity and 'WORKER.submit(' in activity
assert 'System::nanoTime' in store_source and 'disconnectLater(value)' in store_source
assert 'android:exported="false"' in manifest.split('android:name=".ActivationActivity"')[1].split('/>')[0]
assert 'salon-installation-activation-keystore-v1' in encrypted
assert 'GoogleDrive' not in encrypted and 'SalonDatabase' not in encrypted
gate_prefix = re.search(r'    @Override public void onCreate\(Bundle savedInstanceState\) \{\n(.*?)        database = new SalonDatabase\(this\);', main, re.S).group(1)
assert 'if (redirectForActivation()) return;' in gate_prefix
assert main.index('if (redirectForActivation()) return;') < main.index('new WebView(this)')


def method(name):
    found = re.search(r'^    (?:@Override )?(?:private|protected|public) [\w<>\[\].]+ ' + name + r'\([^\n]*\) \{\n.*?^    \}', main, re.M | re.S)
    assert found, name
    return found.group(0)


stubs = {
'android/util/Base64.java': '''package android.util;public final class Base64 {
public static final int DEFAULT=0,NO_PADDING=1,NO_WRAP=2,URL_SAFE=8;
public static byte[] decode(String text,int flags){return (flags&URL_SAFE)!=0?java.util.Base64.getUrlDecoder().decode(text):java.util.Base64.getMimeDecoder().decode(text);}
public static String encodeToString(byte[] bytes,int flags){java.util.Base64.Encoder e=(flags&URL_SAFE)!=0?java.util.Base64.getUrlEncoder():java.util.Base64.getEncoder();if((flags&NO_PADDING)!=0)e=e.withoutPadding();return e.encodeToString(bytes);}}
''',
'android/content/SharedPreferences.java': '''package android.content;import java.util.*;public final class SharedPreferences {
public final Map<String,String> values=new HashMap<>();public boolean failCommit;public int commits;
public String getString(String key,String fallback){return values.getOrDefault(key,fallback);}public Editor edit(){return new Editor();}
public final class Editor {boolean erase;final Map<String,String> updates=new HashMap<>();public Editor putString(String k,String v){updates.put(k,v);return this;}public Editor clear(){erase=true;return this;}public boolean commit(){commits++;if(failCommit)return false;if(erase)values.clear();values.putAll(updates);return true;}}}
''',
'android/content/Context.java': '''package android.content;import java.util.*;public class Context {
public static final int MODE_PRIVATE=0;public final Map<String,SharedPreferences> buckets;public String packageName="ro.caiuspoputa.agendasalon";
public Context(){buckets=new HashMap<>();}public Context(Context old){buckets=old.buckets;packageName=old.packageName;}
public Context getApplicationContext(){return this;}public String getPackageName(){return packageName;}
public SharedPreferences getSharedPreferences(String name,int mode){if(mode!=0)throw new AssertionError("non-private preferences");return buckets.computeIfAbsent(name,x->new SharedPreferences());}}
''',
'android/content/Intent.java': '''package android.content;public final class Intent {
public static final String ACTION_VIEW="android.intent.action.VIEW";private String action,data;public Class<?> target;
public Intent(Context context,Class<?> target){this.target=target;}public Intent(String action,String data){this.action=action;this.data=data;}public String getAction(){return action;}public String getData(){return data;}}
''',
'android/os/Bundle.java': 'package android.os;public final class Bundle {}',
'android/security/keystore/KeyProperties.java': '''package android.security.keystore;public final class KeyProperties {
public static final String KEY_ALGORITHM_AES="AES",BLOCK_MODE_GCM="GCM",ENCRYPTION_PADDING_NONE="NoPadding";public static final int PURPOSE_ENCRYPT=1,PURPOSE_DECRYPT=2;}
''',
'android/security/keystore/KeyGenParameterSpec.java': '''package android.security.keystore;public final class KeyGenParameterSpec implements java.security.spec.AlgorithmParameterSpec {
public String alias;public int purpose,bits;public boolean random,auth;public String mode,padding;
public static final class Builder{final KeyGenParameterSpec value=new KeyGenParameterSpec();public Builder(String alias,int purpose){value.alias=alias;value.purpose=purpose;}public Builder setKeySize(int size){value.bits=size;return this;}public Builder setBlockModes(String mode){value.mode=mode;return this;}public Builder setEncryptionPaddings(String padding){value.padding=padding;return this;}public Builder setRandomizedEncryptionRequired(boolean enabled){value.random=enabled;return this;}public Builder setUserAuthenticationRequired(boolean enabled){value.auth=enabled;return this;}public KeyGenParameterSpec build(){return value;}}}
''',
}

probe_methods = '\n'.join(method(name) for name in ['redirectForActivation', 'onResume', 'onNewIntent'])
gate_probe = '''
class BaseActivity extends android.content.Context {
boolean finishing;int starts,resumes,newIntents;android.content.Intent lastIntent,currentIntent;
protected void onResume(){resumes++;}protected void onNewIntent(android.content.Intent intent){newIntents++;}
void startActivity(android.content.Intent intent){lastIntent=intent;starts++;}void finish(){finishing=true;}boolean isFinishing(){return finishing;}
void setIntent(android.content.Intent intent){currentIntent=intent;}}
class ActivationActivity {}
class MainProbe extends BaseActivity {
boolean destroyed,activationReady,activationRedirecting;int agendaOpens;
public void onCreate(android.os.Bundle state){
''' + gate_prefix.replace('        super.onCreate(savedInstanceState);', '') + '''
agendaOpens++;}
''' + probe_methods + '''
}
'''

test_source = r'''package ro.caiuspoputa.agendasalon;
import android.content.*;import android.os.Bundle;import android.security.keystore.KeyGenParameterSpec;
import org.json.JSONObject;import java.util.*;import java.io.*;import java.net.*;import java.security.*;import java.security.cert.Certificate;import java.security.spec.*;import javax.crypto.*;import javax.net.ssl.*;
public final class ActivationTests {
 static final long NOW=System.currentTimeMillis()/1000;
 static final KeyPair KEYS=keys();static final String SPKI=Base64.getEncoder().encodeToString(KEYS.getPublic().getEncoded());
 static final String ID=UUID.randomUUID().toString(),OTHER_ID=UUID.randomUUID().toString();
 static final String SYNTHETIC_PIN=Integer.toString(100000+new SecureRandom().nextInt(900000));
 static int checks,networkCalls;static FakeConnection nextConnection;static final Map<String,Key> keystore=new HashMap<>();
 interface Checked {void run()throws Exception;}
 static void check(boolean ok,String message){checks++;if(!ok)throw new AssertionError(message);}
 static void denied(Checked action,String message)throws Exception{try{action.run();}catch(Exception expected){checks++;return;}throw new AssertionError(message);}
 static KeyPair keys(){try{KeyPairGenerator g=KeyPairGenerator.getInstance("EC");g.initialize(new ECGenParameterSpec("secp256r1"));return g.generateKeyPair();}catch(Exception e){throw new ExceptionInInitializerError(e);}}
 static String enc(byte[] value){return Base64.getUrlEncoder().withoutPadding().encodeToString(value);}
 static byte[] raw(byte[] der){int p=2;check(der[0]==48,"DER sequence");byte[] out=new byte[64];for(int part=0;part<2;part++){check(der[p++]==2,"DER integer");int n=der[p++]&255;int start=p;while(n>32&&der[start]==0){start++;n--;}check(n<=32,"P256 DER width");System.arraycopy(der,start,out,part*32+32-n,n);p+=der[p-1]&255;}return out;}
 static String sign(JSONObject claims)throws Exception{String body=enc(claims.toString().getBytes("UTF-8"));Signature signature=Signature.getInstance("SHA256withECDSA");signature.initSign(KEYS.getPrivate());signature.update(body.getBytes("UTF-8"));return body+"."+enc(raw(signature.sign()));}
 static JSONObject claims(String id)throws Exception{return new JSONObject().put("v",1).put("iss",ActivationStore.ISSUER).put("aud",ActivationStore.AUDIENCE).put("platform","android").put("installationId",id).put("iat",NOW).put("exp",NOW+ActivationStore.MAX_LIFETIME_SECONDS);}
 static void verification()throws Exception{
  String receipt=sign(claims(ID));check(ActivationStore.verify(receipt,SPKI,ID,NOW),"valid signed synthetic receipt");
  check(!ActivationStore.verify(receipt,SPKI,OTHER_ID,NOW),"installation bound");check(!ActivationStore.verify(receipt,SPKI,ID,NOW+ActivationStore.MAX_LIFETIME_SECONDS),"expired");
  check(!ActivationStore.verify(receipt,Base64.getEncoder().encodeToString(keys().getPublic().getEncoded()),ID,NOW),"different signer");
  for(String field:new String[]{"iss","aud","platform","installationId","v","iat","exp"}){
   JSONObject changed=claims(ID);changed.put(field,field.equals("v")?2:field.equals("iat")?NOW+301:field.equals("exp")?NOW-1:"other");check(!ActivationStore.verify(sign(changed),SPKI,ID,NOW),"wrong signed claim "+field);
  }
  for(JSONObject invalid:new JSONObject[]{claims(ID).put("iat",-1),claims(ID).put("exp",NOW),claims(ID).put("exp",NOW-1),claims(ID).put("iat",NOW+1).put("exp",NOW+1),claims(ID).put("exp",NOW+ActivationStore.MAX_LIFETIME_SECONDS+1),claims(ID).put("iat",Long.toString(NOW)),claims(ID).put("exp",NOW+1.5),claims(ID).put("v","1"),claims(ID).put("platform","web")})check(!ActivationStore.verify(sign(invalid),SPKI,ID,NOW),"chronology/types/platform rejected");
  JSONObject skew=claims(ID).put("iat",NOW+300).put("exp",NOW+301);check(ActivationStore.verify(sign(skew),SPKI,ID,NOW),"bounded clock skew");
  for(String invalid:new String[]{"",receipt+".",receipt+"=",receipt.replace('.',':'),"a.b",receipt.substring(0,receipt.length()-2),"x".repeat(4097)})check(!ActivationStore.verify(invalid,SPKI,ID,NOW),"malformed receipt rejected");
  check(!ActivationStore.verify(receipt,SPKI,"00000000-0000-0000-0000-000000000000",NOW),"non-v4 identity rejected");
  byte[] high=new byte[64];high[0]=(byte)128;high[32]=(byte)255;byte[] result=ActivationStore.derSignature(high);check(result[3]==33&&result[4]==0&&result[5]==(byte)128,"positive DER integers padded");
  byte[] zero=ActivationStore.derSignature(new byte[64]);check(zero.length==8&&zero[3]==1&&zero[6]==1,"minimal zero integers");denied(()->ActivationStore.derSignature(new byte[63]),"bad raw signature length");
  for(int i=0;i<15;i++){String s=sign(claims(ID));check(ActivationStore.verify(s,SPKI,ID,NOW),"P1363 to DER interoperability");}
  System.out.println("PASS real P256 signatures, P1363/DER, canonical encoding, typed claims, expiry/skew/audience/platform/installation binding");
 }
 public static final class KeyProvider extends Provider {public KeyProvider(){super("AndroidKeyStore","1.0","synthetic test adapter");put("KeyStore.AndroidKeyStore",MemoryKeyStore.class.getName());put("KeyGenerator.AES",MemoryKeyGenerator.class.getName());}}
 public static final class MemoryKeyStore extends KeyStoreSpi {
  public Key engineGetKey(String alias,char[] pass){return keystore.get(alias);}public Certificate[] engineGetCertificateChain(String alias){return null;}public Certificate engineGetCertificate(String alias){return null;}public Date engineGetCreationDate(String alias){return new Date();}
  public void engineSetKeyEntry(String alias,Key key,char[] pass,Certificate[] certs){keystore.put(alias,key);}public void engineSetKeyEntry(String alias,byte[] key,Certificate[] certs){throw new UnsupportedOperationException();}public void engineSetCertificateEntry(String alias,Certificate cert){throw new UnsupportedOperationException();}public void engineDeleteEntry(String alias){keystore.remove(alias);}public Enumeration<String> engineAliases(){return Collections.enumeration(keystore.keySet());}public boolean engineContainsAlias(String alias){return keystore.containsKey(alias);}public int engineSize(){return keystore.size();}public boolean engineIsKeyEntry(String alias){return keystore.containsKey(alias);}public boolean engineIsCertificateEntry(String alias){return false;}public String engineGetCertificateAlias(Certificate cert){return null;}public void engineStore(OutputStream out,char[] pass){}public void engineLoad(InputStream input,char[] pass){}
 }
 public static final class MemoryKeyGenerator extends KeyGeneratorSpi {
  KeyGenParameterSpec parameters;protected void engineInit(SecureRandom random){throw new AssertionError();}protected void engineInit(int size,SecureRandom random){throw new AssertionError();}protected void engineInit(AlgorithmParameterSpec spec,SecureRandom random){parameters=(KeyGenParameterSpec)spec;check(parameters.bits==256&&parameters.random&&!parameters.auth&&parameters.purpose==3&&"GCM".equals(parameters.mode)&&"NoPadding".equals(parameters.padding),"strong dedicated GCM key specification");}
  protected SecretKey engineGenerateKey(){try{KeyGenerator g=KeyGenerator.getInstance("AES","SunJCE");g.init(256);SecretKey key=g.generateKey();keystore.put(parameters.alias,key);return key;}catch(Exception e){throw new RuntimeException(e);}}
 }
 static void encryptStore()throws Exception{
  Context context=new Context();EncryptedActivationStore store=new EncryptedActivationStore(context);check(store.read("receipt")==null,"empty new store");store.put("installation-id",ID);store.put("receipt","synthetic-secret");check(store.read("receipt").equals("synthetic-secret"),"AES-GCM roundtrip");
  SharedPreferences pref=context.getSharedPreferences(EncryptedActivationStore.PREFERENCES,0);String first=pref.values.get("receipt");check(!first.contains("synthetic-secret")&&!first.contains(ID),"ciphertext only persisted");store.put("receipt","synthetic-secret");check(!first.equals(pref.values.get("receipt")),"fresh IV per write");
  Context update=new Context(context);check(new EncryptedActivationStore(update).read("installation-id").equals(ID),"reopen/update keeps installation id");
  String valid=pref.values.get("receipt"),id=pref.values.get("installation-id");pref.values.put("receipt",id);denied(()->store.read("receipt"),"AAD separates record names");pref.values.put("receipt",valid);
  Context foreign=new Context(context);foreign.packageName="another.application";denied(()->new EncryptedActivationStore(foreign).read("receipt"),"AAD binds package");
  pref.failCommit=true;denied(()->store.put("receipt","replacement"),"write failure surfaced");pref.failCommit=false;check(store.read("receipt").equals("synthetic-secret"),"failed commit preserves previous receipt");
  denied(()->store.put("receipt","x".repeat(8193)),"bounded plain record");denied(()->store.read("google-token"),"unsupported record inaccessible");pref.values.put("receipt",valid.replace("ciphertext","corrupted"));denied(()->store.read("receipt"),"corrupted envelope rejected");pref.values.put("receipt",valid);
  context.getSharedPreferences("business",0).values.put("appointments","untouched");context.getSharedPreferences("ha",0).values.put("grant","untouched");store.resetForReactivation();check(pref.values.isEmpty()&&!keystore.containsKey(EncryptedActivationStore.KEY_ALIAS),"reset only dedicated activation bucket and alias");check(context.getSharedPreferences("business",0).values.get("appointments").equals("untouched")&&context.getSharedPreferences("ha",0).values.get("grant").equals("untouched"),"business and HA stores untouched");
  System.out.println("PASS actual encrypted store with real AES-GCM: randomized IVs, AAD binding, failed writes, bounds, separate reset and update persistence");
 }
 static final class FakeConnection extends HttpsURLConnection {
  final ByteArrayOutputStream output=new ByteArrayOutputStream();int status=200;volatile int disconnects;java.util.concurrent.atomic.AtomicLong expireClock;String kind="valid";ActivationStore.Request cancelDuringRead;Context replaceIdContext;boolean requested;
  FakeConnection()throws Exception{super(new URL(ActivationStore.ENDPOINT));}
  public void disconnect(){disconnects++;}public boolean usingProxy(){return false;}public void connect(){}public OutputStream getOutputStream(){return output;}
  public int getResponseCode(){requested=true;return status;}
  public InputStream getInputStream()throws IOException{try{
   JSONObject request=new JSONObject(output.toString("UTF-8"));check(request.getString("pin").equals(SYNTHETIC_PIN)&&request.getString("platform").equals("android"),"exact synthetic request fields");
   if(replaceIdContext!=null)new EncryptedActivationStore(replaceIdContext).put("installation-id",OTHER_ID);
   String id=request.getString("installationId"),response=kind.equals("oversize")?"x".repeat(16385):kind.equals("invalid-json")?"{":new JSONObject().put("activated",kind.equals("string-bool")?"true":true).put("receipt",sign(claims(kind.equals("wrong-install")?OTHER_ID:id))).toString();
   byte[] bytes=response.getBytes("UTF-8");return new ByteArrayInputStream(bytes){public synchronized int read(byte[] b,int off,int len){if(cancelDuringRead!=null)cancelDuringRead.cancel();if(expireClock!=null)expireClock.set(java.util.concurrent.TimeUnit.MILLISECONDS.toNanos(ActivationStore.REQUEST_TIMEOUT_MILLIS));return super.read(b,off,len);}};
  }catch(Exception e){throw new IOException("synthetic input failure",e);}}
  public String getCipherSuite(){return "synthetic";}public Certificate[] getLocalCertificates(){return null;}public Certificate[] getServerCertificates(){return null;}
 }
 static void awaitClosed(FakeConnection connection)throws Exception{long end=System.nanoTime()+2_000_000_000L;while(connection.disconnects==0&&System.nanoTime()<end)Thread.sleep(1);check(connection.disconnects==1,"asynchronous bounded disconnect completed once");}
 static FakeConnection network()throws Exception{nextConnection=new FakeConnection();return nextConnection;}
 static void activation()throws Exception{
  URL.setURLStreamHandlerFactory(protocol->protocol.equals("https")?new URLStreamHandler(){protected URLConnection openConnection(URL url)throws IOException{check(url.toString().equals(ActivationStore.ENDPOINT),"fixed HTTPS endpoint only");networkCalls++;if(nextConnection==null)throw new IOException("offline synthetic");return nextConnection;}}:null);
  final Context context=new Context();check(!ActivationStore.ready(context)&&context.getSharedPreferences(EncryptedActivationStore.PREFERENCES,0).values.isEmpty(),"ready never creates installation identity or writes on first boot");
  FakeConnection connection=network();ActivationStore.activate(context,SYNTHETIC_PIN,new ActivationStore.Request());check(ActivationStore.ready(context),"one successful activation durable");String id=ActivationStore.installationId(context),receipt=ActivationStore.token(context);awaitClosed(connection);check(connection.disconnects==1&&connection.requested&&!connection.getInstanceFollowRedirects()&&!connection.getUseCaches()&&connection.getConnectTimeout()==15000&&connection.getReadTimeout()==20000,"bounded fixed POST without redirects/caching and final disconnect");check("Agenda-Salon-Android".equals(connection.getRequestProperty("User-Agent")),"honest Android app User-Agent header");
  int calls=networkCalls;nextConnection=null;check(ActivationStore.ready(new Context(context))&&ActivationStore.installationId(context).equals(id)&&networkCalls==calls,"offline reopen/update verifies locally without network");
  check(!receipt.contains(SYNTHETIC_PIN),"receipt contains no PIN");
  for(int status:new int[]{400,401,429,302,403,503}){connection=network();connection.status=status;final FakeConnection expected=connection;denied(()->ActivationStore.activate(context,SYNTHETIC_PIN,new ActivationStore.Request()),"HTTP failure must reject");awaitClosed(expected);check(expected.disconnects==1&&ActivationStore.token(context).equals(receipt),"HTTP failure preserves prior activation");}
  for(String kind:new String[]{"wrong-install","oversize","invalid-json","string-bool"}){connection=network();connection.kind=kind;denied(()->ActivationStore.activate(context,SYNTHETIC_PIN,new ActivationStore.Request()),"invalid server response rejected");check(ActivationStore.token(context).equals(receipt),"invalid result cannot replace prior receipt");}
  ActivationStore.Request cancelled=new ActivationStore.Request();cancelled.cancel();calls=networkCalls;denied(()->ActivationStore.activate(context,SYNTHETIC_PIN,cancelled),"cancelled before request");check(networkCalls==calls,"no network after pre-cancel");
  connection=network();ActivationStore.Request during=new ActivationStore.Request();connection.cancelDuringRead=during;denied(()->ActivationStore.activate(context,SYNTHETIC_PIN,during),"cancel while streaming");check(ActivationStore.token(context).equals(receipt),"cancelled result not persisted");
  java.util.concurrent.atomic.AtomicLong monotonic=new java.util.concurrent.atomic.AtomicLong();ActivationStore.Request expired=new ActivationStore.Request(monotonic::get);monotonic.set(java.util.concurrent.TimeUnit.MILLISECONDS.toNanos(ActivationStore.REQUEST_TIMEOUT_MILLIS));calls=networkCalls;denied(()->ActivationStore.activate(context,SYNTHETIC_PIN,expired),"expired before request");check(networkCalls==calls,"deadline avoids new network");
  monotonic.set(0);ActivationStore.Request trickle=new ActivationStore.Request(monotonic::get);connection=network();connection.expireClock=monotonic;denied(()->ActivationStore.activate(context,SYNTHETIC_PIN,trickle),"slow trickle crossing total deadline rejected");check(ActivationStore.token(context).equals(receipt),"late complete receipt cannot be saved after deadline");
  connection=network();connection.replaceIdContext=context;denied(()->ActivationStore.activate(context,SYNTHETIC_PIN,new ActivationStore.Request()),"changed install id cannot receive stale receipt");check(!ActivationStore.ready(context),"stale identity fails closed");
  Context repair=new Context();repair.getSharedPreferences("business",0).values.put("appointments","untouched");repair.getSharedPreferences("ha",0).values.put("grant","untouched");repair.getSharedPreferences(EncryptedActivationStore.PREFERENCES,0).values.put("installation-id","corrupt");network();ActivationStore.activate(repair,SYNTHETIC_PIN,new ActivationStore.Request());check(ActivationStore.ready(repair),"explicit PIN repairs activation store corruption");check(repair.getSharedPreferences("business",0).values.get("appointments").equals("untouched")&&repair.getSharedPreferences("ha",0).values.get("grant").equals("untouched"),"explicit repair preserves business and HA data");
  System.out.println("PASS actual activation request: synthetic HTTPS provider, success/offline persistence, status errors, bad receipts, cancellation, stale identity and isolated repair");
 }
 static void prepare(Context context)throws Exception{String id=ActivationStore.installationId(context);new EncryptedActivationStore(context).put("receipt",sign(claims(id)));}
 static void lifecycle()throws Exception{
  MainProbe blocked=new MainProbe();blocked.onCreate(new Bundle());check(blocked.agendaOpens==0&&!blocked.activationReady&&blocked.starts==1&&blocked.finishing&&blocked.lastIntent.target==ActivationActivity.class,"new unactivated install cannot open agenda");blocked.onResume();check(blocked.starts==1&&blocked.agendaOpens==0,"resume of uninitialized redirect is safe");
  MainProbe active=new MainProbe();prepare(active);active.onCreate(new Bundle());check(active.agendaOpens==1&&active.activationReady&&active.starts==0,"valid activation opens agenda once");active.onResume();check(active.starts==0,"valid foreground reopening needs no PIN/network");active.onNewIntent(new Intent(Intent.ACTION_VIEW,"synthetic-oauth-callback"));check(active.newIntents==1&&active.currentIntent.getData().equals("synthetic-oauth-callback"),"activated ordinary intent preserves lifecycle without account integration");
  new EncryptedActivationStore(active).resetForReactivation();active.onResume();check(active.starts==1&&active.finishing&&!active.activationReady,"invalid activation on resume closes initialized app behind activation gate");active.onNewIntent(new Intent(Intent.ACTION_VIEW,"ignored"));check(active.starts==1&&!active.activationReady,"unactivated new intent cannot reopen agenda or duplicate gate");
  System.out.println("PASS actual MainActivity gate prefixes/methods: no DB/WebView before activation, safe uninitialized resume and activated ordinary-intent lifecycle");
 }
 public static void main(String[] args)throws Exception{Security.addProvider(new KeyProvider());verification();encryptStore();activation();lifecycle();System.out.println("PASS native activation: "+checks+" assertions; synthetic keys/PIN only; physicalDeviceTested=false");}
}
'''

with tempfile.TemporaryDirectory(prefix='salon-native-activation-') as directory:
    root = Path(directory)
    for name, content in stubs.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf8')
    package = root / 'ro/caiuspoputa/agendasalon'
    package.mkdir(parents=True)
    public_match = re.search(r'(?<=static final String PUBLIC_SPKI = )"[^"]+"', store_source)
    assert public_match
    synthetic_source = store_source[:public_match.start()] + 'ActivationTests.SPKI' + store_source[public_match.end():]
    (package / 'ActivationStore.java').write_text(synthetic_source, encoding='utf8')
    (package / 'EncryptedActivationStore.java').write_text(encrypted, encoding='utf8')
    (package / 'ActivationTests.java').write_text(test_source + gate_probe, encoding='utf8')
    classes = root / 'classes'
    subprocess.run([str(JAVA / 'javac.exe'), '-encoding', 'UTF-8', '-cp', str(JSON_CLASSES), '-d', str(classes),
                    *map(str, root.rglob('*.java'))], check=True, timeout=40)
    subprocess.run([str(JAVA / 'java.exe'), '-Xmx96m', '-cp', str(classes) + ';' + str(JSON_CLASSES),
                    'ro.caiuspoputa.agendasalon.ActivationTests'], check=True, timeout=30)
