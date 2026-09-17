package io.github.hgs3767994.wuwangwo;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(TrustedSessionPlugin.class);
        registerPlugin(OAuthSessionPlugin.class);
        registerPlugin(NativeFileExportPlugin.class);
        registerPlugin(GoogleDriveAuthorizationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
