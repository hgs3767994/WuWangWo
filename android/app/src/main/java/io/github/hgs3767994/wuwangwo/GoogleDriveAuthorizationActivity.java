package io.github.hgs3767994.wuwangwo;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;

import java.util.Arrays;
import java.util.List;

public class GoogleDriveAuthorizationActivity extends AppCompatActivity {
    public static final String EXTRA_SERVER_CLIENT_ID = "serverClientId";
    public static final String EXTRA_SERVER_AUTH_CODE = "serverAuthCode";
    public static final String EXTRA_ERROR = "error";
    private final ActivityResultLauncher<IntentSenderRequest> authorizationLauncher = registerForActivityResult(
        new ActivityResultContracts.StartIntentSenderForResult(),
        result -> {
            if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
                reject("native-oauth-authorization-cancelled");
                return;
            }
            try {
                resolve(Identity.getAuthorizationClient(this).getAuthorizationResultFromIntent(result.getData()));
            } catch (ApiException error) {
                reject("native-oauth-authorization-failed");
            }
        }
    );

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState != null) return;
        String serverClientId = getIntent().getStringExtra(EXTRA_SERVER_CLIENT_ID);
        if (serverClientId == null || !serverClientId.endsWith(".apps.googleusercontent.com")) {
            reject("native-oauth-server-client-id-invalid");
            return;
        }

        List<Scope> scopes = Arrays.asList(
            new Scope("https://www.googleapis.com/auth/drive.appdata"),
            new Scope("openid"),
            new Scope("email")
        );
        AuthorizationRequest request = AuthorizationRequest.builder()
            .setRequestedScopes(scopes)
            .requestOfflineAccess(serverClientId)
            .build();

        Identity.getAuthorizationClient(this).authorize(request)
            .addOnSuccessListener(result -> {
                if (result.hasResolution() && result.getPendingIntent() != null) {
                    authorizationLauncher.launch(new IntentSenderRequest.Builder(result.getPendingIntent().getIntentSender()).build());
                    return;
                }
                resolve(result);
            })
            .addOnFailureListener(error -> reject("native-oauth-authorization-failed"));
    }

    private void resolve(AuthorizationResult result) {
        String serverAuthCode = result.getServerAuthCode();
        if (serverAuthCode == null || serverAuthCode.trim().isEmpty()) {
            reject("native-oauth-authorization-code-missing");
            return;
        }
        Intent data = new Intent();
        data.putExtra(EXTRA_SERVER_AUTH_CODE, serverAuthCode);
        setResult(Activity.RESULT_OK, data);
        finish();
    }

    private void reject(String code) {
        Intent data = new Intent();
        data.putExtra(EXTRA_ERROR, code);
        setResult(Activity.RESULT_CANCELED, data);
        finish();
    }
}
