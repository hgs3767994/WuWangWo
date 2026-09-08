package io.github.hgs3767994.wuwangwo;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

@CapacitorPlugin(name = "NativeFileExport")
public class NativeFileExportPlugin extends Plugin {
    private static final String EXPORT_FOLDER = "莫忘";

    @PluginMethod
    public void save(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("native-file-export-requires-android-10");
            return;
        }

        Uri itemUri = null;
        try {
            String filename = sanitizeFilename(required(call, "filename"));
            String mimeType = call.getString("mimeType");
            if (mimeType == null || mimeType.trim().isEmpty()) mimeType = "application/octet-stream";
            byte[] bytes = Base64.decode(required(call, "base64Data"), Base64.NO_WRAP);

            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
            values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + EXPORT_FOLDER);
            values.put(MediaStore.Downloads.IS_PENDING, 1);

            ContentResolver resolver = getContext().getContentResolver();
            itemUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (itemUri == null) throw new IllegalStateException("native-file-export-create-failed");

            try (OutputStream stream = resolver.openOutputStream(itemUri, "w")) {
                if (stream == null) throw new IllegalStateException("native-file-export-stream-failed");
                stream.write(bytes);
                stream.flush();
            } finally {
                java.util.Arrays.fill(bytes, (byte) 0);
            }

            ContentValues completed = new ContentValues();
            completed.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(itemUri, completed, null, null);

            JSObject response = new JSObject();
            response.put("filename", filename);
            response.put("location", "下載／莫忘");
            response.put("uri", itemUri.toString());
            call.resolve(response);
        } catch (Exception error) {
            if (itemUri != null) getContext().getContentResolver().delete(itemUri, null, null);
            call.reject("native-file-export-failed", error);
        }
    }

    private static String required(PluginCall call, String name) {
        String value = call.getString(name);
        if (value == null || value.trim().isEmpty()) throw new IllegalArgumentException("native-file-export-invalid-" + name);
        return value;
    }

    private static String sanitizeFilename(String value) {
        String filename = value
            .replace('/', '_')
            .replace('\\', '_')
            .replace(':', '_')
            .replace('*', '_')
            .replace('?', '_')
            .replace('"', '_')
            .replace('<', '_')
            .replace('>', '_')
            .replace('|', '_');
        if (filename.isEmpty()) throw new IllegalArgumentException("native-file-export-invalid-filename");
        return filename;
    }
}
