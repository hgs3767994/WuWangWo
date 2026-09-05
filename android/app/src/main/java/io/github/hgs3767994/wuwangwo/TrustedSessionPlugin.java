package io.github.hgs3767994.wuwangwo;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.concurrent.Executor;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "TrustedSession")
public class TrustedSessionPlugin extends Plugin {
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "forget-me-not.trusted-session.v1";
    private static final String PREFERENCES = "forget_me_not_trusted_session";
    private static final String CIPHERTEXT = "ciphertext";
    private static final String IV = "iv";
    private static final String VAULT_ID = "vaultId";
    private static final String DEVICE_ID = "deviceId";
    private static final String SESSION_EPOCH = "sessionEpoch";

    @PluginMethod
    public void store(PluginCall call) {
        try {
            String vaultId = required(call, "vaultId");
            String deviceId = required(call, "deviceId");
            Integer sessionEpoch = call.getInt("sessionEpoch");
            String dekBase64 = required(call, "dekBase64");
            if (sessionEpoch == null || sessionEpoch < 0) throw new IllegalArgumentException("trusted-session-invalid-epoch");

            byte[] dek = Base64.decode(dekBase64, Base64.NO_WRAP);
            if (dek.length != 32) throw new IllegalArgumentException("trusted-session-invalid-dek");
            try {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
                cipher.updateAAD(aad(vaultId, deviceId, sessionEpoch));
                byte[] ciphertext = cipher.doFinal(dek);
                preferences().edit()
                    .putString(CIPHERTEXT, Base64.encodeToString(ciphertext, Base64.NO_WRAP))
                    .putString(IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                    .putString(VAULT_ID, vaultId)
                    .putString(DEVICE_ID, deviceId)
                    .putInt(SESSION_EPOCH, sessionEpoch)
                    .apply();
                call.resolve();
            } finally {
                java.util.Arrays.fill(dek, (byte) 0);
            }
        } catch (Exception error) {
            call.reject("trusted-session-store-failed", error);
        }
    }

    @PluginMethod
    public void restore(PluginCall call) {
        try {
            String vaultId = required(call, "vaultId");
            String deviceId = required(call, "deviceId");
            Integer sessionEpoch = call.getInt("sessionEpoch");
            if (sessionEpoch == null || !matchesStoredRecord(vaultId, deviceId, sessionEpoch)) {
                call.reject("trusted-session-native-record-missing");
                return;
            }
            int authenticators = BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
            int capability = BiometricManager.from(getContext()).canAuthenticate(authenticators);
            if (capability != BiometricManager.BIOMETRIC_SUCCESS) {
                call.reject("trusted-session-auth-unavailable");
                return;
            }
            if (!(getActivity() instanceof FragmentActivity)) {
                call.reject("trusted-session-auth-unavailable");
                return;
            }
            authenticateAndRestore(call, vaultId, deviceId, sessionEpoch, authenticators);
        } catch (Exception error) {
            call.reject("trusted-session-restore-failed", error);
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
            call.reject("trusted-session-clear-failed", error);
        }
    }

    private void authenticateAndRestore(PluginCall call, String vaultId, String deviceId, int sessionEpoch, int authenticators) {
        Executor executor = ContextCompat.getMainExecutor(getContext());
        BiometricPrompt prompt = new BiometricPrompt((FragmentActivity) getActivity(), executor, new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                super.onAuthenticationSucceeded(result);
                try {
                    byte[] plaintext = decrypt(vaultId, deviceId, sessionEpoch);
                    JSObject response = new JSObject();
                    response.put("dekBase64", Base64.encodeToString(plaintext, Base64.NO_WRAP));
                    java.util.Arrays.fill(plaintext, (byte) 0);
                    call.resolve(response);
                } catch (Exception error) {
                    call.reject("trusted-session-restore-failed", error);
                }
            }

            @Override
            public void onAuthenticationError(int errorCode, @NonNull CharSequence errorMessage) {
                super.onAuthenticationError(errorCode, errorMessage);
                call.reject("trusted-session-auth-cancelled");
            }
        });
        BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
            .setTitle("解鎖莫忘")
            .setSubtitle("驗證你的身分以解鎖此裝置")
            .setAllowedAuthenticators(authenticators)
            .build();
        prompt.authenticate(promptInfo);
    }

    private byte[] decrypt(String vaultId, String deviceId, int sessionEpoch) throws Exception {
        String ciphertext = preferences().getString(CIPHERTEXT, null);
        String iv = preferences().getString(IV, null);
        if (ciphertext == null || iv == null) throw new IllegalStateException("trusted-session-native-record-missing");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
        cipher.updateAAD(aad(vaultId, deviceId, sessionEpoch));
        return cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP));
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

    private boolean matchesStoredRecord(String vaultId, String deviceId, int sessionEpoch) {
        SharedPreferences preferences = preferences();
        return vaultId.equals(preferences.getString(VAULT_ID, null))
            && deviceId.equals(preferences.getString(DEVICE_ID, null))
            && sessionEpoch == preferences.getInt(SESSION_EPOCH, -1);
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    private static String required(PluginCall call, String name) {
        String value = call.getString(name);
        if (value == null || value.trim().isEmpty()) throw new IllegalArgumentException("trusted-session-invalid-" + name);
        return value;
    }

    private static byte[] aad(String vaultId, String deviceId, int sessionEpoch) {
        return (vaultId + "\u0000" + deviceId + "\u0000" + sessionEpoch).getBytes(StandardCharsets.UTF_8);
    }
}
