package io.github.hgs3767994.wuwangwo;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;

public class GoogleDriveAuthorizationActivity extends AppCompatActivity {
    public static final String EXTRA_PENDING_INTENT = "pendingIntent";
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
        PendingIntent pendingIntent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pendingIntent = getIntent().getParcelableExtra(EXTRA_PENDING_INTENT, PendingIntent.class);
        } else {
            pendingIntent = getIntent().getParcelableExtra(EXTRA_PENDING_INTENT);
        }
        if (pendingIntent == null) {
            reject("native-oauth-authorization-failed");
            return;
        }
        authorizationLauncher.launch(new IntentSenderRequest.Builder(pendingIntent.getIntentSender()).build());
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
