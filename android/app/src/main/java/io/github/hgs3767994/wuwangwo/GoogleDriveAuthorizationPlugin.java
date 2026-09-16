package io.github.hgs3767994.wuwangwo;

import android.app.Activity;
import android.content.Intent;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "GoogleDriveAuthorization")
public class GoogleDriveAuthorizationPlugin extends Plugin {
    @PluginMethod
    public void authorize(PluginCall call) {
        String serverClientId = call.getString("serverClientId", "").trim();
        if (!serverClientId.endsWith(".apps.googleusercontent.com")) {
            call.reject("native-oauth-server-client-id-invalid");
            return;
        }
        Intent intent = new Intent(getContext(), GoogleDriveAuthorizationActivity.class);
        intent.putExtra(GoogleDriveAuthorizationActivity.EXTRA_SERVER_CLIENT_ID, serverClientId);
        startActivityForResult(call, intent, "handleAuthorizationResult");
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
}
