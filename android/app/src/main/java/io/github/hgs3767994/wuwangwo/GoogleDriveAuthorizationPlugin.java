package io.github.hgs3767994.wuwangwo;

import android.app.Activity;
import android.content.Intent;

import androidx.activity.result.ActivityResult;

import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Arrays;
import java.util.List;

@CapacitorPlugin(name = "GoogleDriveAuthorization")
public class GoogleDriveAuthorizationPlugin extends Plugin {
    @PluginMethod
    public void authorize(PluginCall call) {
        String serverClientId = call.getString("serverClientId", "").trim();
        boolean selectAccount = Boolean.TRUE.equals(call.getBoolean("selectAccount"));
        if (!serverClientId.endsWith(".apps.googleusercontent.com")) {
            call.reject("native-oauth-server-client-id-invalid");
            return;
        }
        List<Scope> scopes = Arrays.asList(
            new Scope("https://www.googleapis.com/auth/drive.appdata"),
            new Scope("openid"),
            new Scope("email")
        );
        AuthorizationRequest.Builder requestBuilder = AuthorizationRequest.builder()
            .setRequestedScopes(scopes)
            .requestOfflineAccess(serverClientId);
        if (selectAccount) {
            requestBuilder.setPrompt(AuthorizationRequest.Prompt.SELECT_ACCOUNT);
        }
        AuthorizationRequest request = requestBuilder.build();

        Identity.getAuthorizationClient(getActivity()).authorize(request)
            .addOnSuccessListener(result -> {
                if (result.hasResolution() && result.getPendingIntent() != null) {
                    Intent intent = new Intent(getContext(), GoogleDriveAuthorizationActivity.class);
                    intent.putExtra(GoogleDriveAuthorizationActivity.EXTRA_PENDING_INTENT, result.getPendingIntent());
                    startActivityForResult(call, intent, "handleAuthorizationResult");
                    return;
                }
                resolveAuthorization(call, result);
            })
            .addOnFailureListener(error -> call.reject("native-oauth-authorization-failed", error));
    }

    @ActivityCallback
    private void handleAuthorizationResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null) {
            String error = data == null ? "native-oauth-authorization-cancelled" : data.getStringExtra(GoogleDriveAuthorizationActivity.EXTRA_ERROR);
            call.reject(error == null ? "native-oauth-authorization-cancelled" : error);
            return;
        }
        String serverAuthCode = data.getStringExtra(GoogleDriveAuthorizationActivity.EXTRA_SERVER_AUTH_CODE);
        if (serverAuthCode == null || serverAuthCode.trim().isEmpty()) {
            call.reject("native-oauth-authorization-code-missing");
            return;
        }
        JSObject response = new JSObject();
        response.put("serverAuthCode", serverAuthCode);
        call.resolve(response);
    }

    private void resolveAuthorization(PluginCall call, AuthorizationResult result) {
        String serverAuthCode = result.getServerAuthCode();
        if (serverAuthCode == null || serverAuthCode.trim().isEmpty()) {
            call.reject("native-oauth-authorization-code-missing");
            return;
        }
        JSObject response = new JSObject();
        response.put("serverAuthCode", serverAuthCode);
        call.resolve(response);
    }
}
