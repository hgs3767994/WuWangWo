package io.github.hgs3767994.wuwangwo;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "OAuthSession")
public class OAuthSessionPlugin extends Plugin {
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "forget-me-not.oauth-session.v1";
    private static final String PREFERENCES = "forget_me_not_oauth_session";
    private static final String CIPHERTEXT = "ciphertext";
    private static final String IV = "iv";

    @PluginMethod
    public void store(PluginCall call) {
        try {
            String sessionToken = required(call, "sessionToken");
            String expiresAt = required(call, "expiresAt");
            String renewalToken = required(call, "renewalToken");
            String renewalExpiresAt = required(call, "renewalExpiresAt");
            String accountEmail = call.getString("accountEmail", "");
            JSONObject payload = new JSONObject();
            payload.put("sessionToken", sessionToken);
            payload.put("expiresAt", expiresAt);
            payload.put("renewalToken", renewalToken);
            payload.put("renewalExpiresAt", renewalExpiresAt);
            payload.put("accountEmail", accountEmail == null ? "" : accountEmail);

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            cipher.updateAAD(KEY_ALIAS.getBytes(StandardCharsets.UTF_8));
            byte[] ciphertext = cipher.doFinal(payload.toString().getBytes(StandardCharsets.UTF_8));
            preferences().edit()
                .putString(CIPHERTEXT, Base64.encodeToString(ciphertext, Base64.NO_WRAP))
                .putString(IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .apply();
            call.resolve();
        } catch (Exception error) {
            call.reject("oauth-session-store-failed", error);
        }
    }

    @PluginMethod
    public void load(PluginCall call) {
        try {
            String ciphertext = preferences().getString(CIPHERTEXT, null);
            String iv = preferences().getString(IV, null);
            if (ciphertext == null || iv == null) {
                call.resolve(new JSObject());
                return;
            }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            cipher.updateAAD(KEY_ALIAS.getBytes(StandardCharsets.UTF_8));
            byte[] plaintext = cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP));
            try {
                JSONObject payload = new JSONObject(new String(plaintext, StandardCharsets.UTF_8));
                JSObject response = new JSObject();
                response.put("sessionToken", payload.optString("sessionToken", ""));
                response.put("expiresAt", payload.optString("expiresAt", ""));
                response.put("renewalToken", payload.optString("renewalToken", ""));
                response.put("renewalExpiresAt", payload.optString("renewalExpiresAt", ""));
                response.put("accountEmail", payload.optString("accountEmail", ""));
                call.resolve(response);
            } finally {
                java.util.Arrays.fill(plaintext, (byte) 0);
            }
        } catch (Exception error) {
            preferences().edit().clear().apply();
            call.reject("oauth-session-load-failed", error);
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        try {
            preferences().edit().clear().apply();
            KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
            keyStore.load(null);
            if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS);
            call.resolve();
        } catch (Exception error) {
            call.reject("oauth-session-clear-failed", error);
        }
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return generator.generateKey();
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    private static String required(PluginCall call, String name) {
        String value = call.getString(name);
        if (value == null || value.trim().isEmpty()) throw new IllegalArgumentException("oauth-session-invalid-" + name);
        return value;
    }
}
