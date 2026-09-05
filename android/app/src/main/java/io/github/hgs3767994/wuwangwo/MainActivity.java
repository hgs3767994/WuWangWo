package io.github.hgs3767994.wuwangwo;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(TrustedSessionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
