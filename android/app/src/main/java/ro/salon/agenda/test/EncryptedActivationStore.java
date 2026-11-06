package ro.salon.agenda.test;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.Key;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Installation activation only. Never stores the PIN or touches business/HA stores. */
final class EncryptedActivationStore {
    private static final Object LOCK = new Object();
    static final String PREFERENCES = "salon-installation-activation-v1";
    static final String KEY_ALIAS = "salon-installation-activation-keystore-v1";
    private static final int MAX_CLEAR_BYTES = 8192, MAX_ENVELOPE_CHARS = 13000;
    private final SharedPreferences preferences;
    private final String packageName;

    EncryptedActivationStore(Context context) {
        Context app = context.getApplicationContext();
        packageName = app.getPackageName();
        preferences = app.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    String read(String name) throws IOException {
        synchronized (LOCK) {
            try {
                String encoded = preferences.getString(record(name), null);
                if (encoded == null) return null;
                if (encoded.length() > MAX_ENVELOPE_CHARS) throw new IOException("Activation envelope size");
                JSONObject envelope = new JSONObject(encoded);
                if (envelope.getInt("v") != 1) throw new IOException("Activation envelope version");
                byte[] iv = Base64.decode(envelope.getString("iv"), Base64.NO_WRAP);
                byte[] ciphertext = Base64.decode(envelope.getString("ciphertext"), Base64.NO_WRAP);
                if (iv.length != 12 || ciphertext.length < 16 || ciphertext.length > MAX_CLEAR_BYTES + 16)
                    throw new IOException("Activation envelope shape");
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, iv));
                cipher.updateAAD(aad(name));
                byte[] plain = cipher.doFinal(ciphertext);
                if (plain.length > MAX_CLEAR_BYTES) throw new IOException("Activation value size");
                return new String(plain, StandardCharsets.UTF_8);
            } catch (Exception invalid) {
                throw new IOException("Activarea locală nu poate fi citită. Introdu din nou PIN-ul.", invalid);
            }
        }
    }

    void put(String name, String value) throws IOException {
        if (value == null || value.getBytes(StandardCharsets.UTF_8).length > MAX_CLEAR_BYTES)
            throw new IOException("Activation value size");
        synchronized (LOCK) {
            try {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, key(true));
                cipher.updateAAD(aad(name));
                byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
                byte[] iv = cipher.getIV();
                if (iv == null || iv.length != 12) throw new IOException("Activation IV");
                JSONObject envelope = new JSONObject().put("v", 1)
                    .put("iv", Base64.encodeToString(iv, Base64.NO_WRAP))
                    .put("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP));
                if (!preferences.edit().putString(record(name), envelope.toString()).commit())
                    throw new IOException("Activation commit failed");
            } catch (Exception failure) {
                throw new IOException("Activarea nu a putut fi salvată în siguranță. Reîncearcă.", failure);
            }
        }
    }

    /** Called only after an explicit PIN submission if this dedicated store is unreadable. */
    void resetForReactivation() throws IOException {
        synchronized (LOCK) {
            try {
                if (!preferences.edit().clear().commit()) throw new IOException("Activation reset commit failed");
                KeyStore keys = keyStore();
                if (keys.containsAlias(KEY_ALIAS)) keys.deleteEntry(KEY_ALIAS);
            } catch (Exception failure) {
                throw new IOException("Activarea locală nu a putut fi pregătită. Reîncearcă.", failure);
            }
        }
    }

    private static String record(String name) {
        if (!("installation-id".equals(name) || "receipt".equals(name)))
            throw new IllegalArgumentException("Unsupported activation record");
        return name;
    }

    private byte[] aad(String name) {
        return (packageName + "|activation.v1|" + record(name)).getBytes(StandardCharsets.UTF_8);
    }

    private static KeyStore keyStore() throws Exception {
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore");
        keys.load(null);
        return keys;
    }

    private static SecretKey key(boolean create) throws Exception {
        KeyStore keys = keyStore();
        if (keys.containsAlias(KEY_ALIAS)) {
            Key value = keys.getKey(KEY_ALIAS, null);
            if (!(value instanceof SecretKey)) throw new IOException("Activation key type");
            return (SecretKey) value;
        }
        if (!create) throw new IOException("Activation key missing");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).setUserAuthenticationRequired(false).build());
        return generator.generateKey();
    }
}
