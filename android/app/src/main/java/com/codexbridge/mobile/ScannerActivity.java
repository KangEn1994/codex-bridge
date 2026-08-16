package com.codexbridge.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.util.Log;
import android.widget.Toast;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.ResultPoint;
import com.journeyapps.barcodescanner.BarcodeCallback;
import com.journeyapps.barcodescanner.BarcodeResult;
import com.journeyapps.barcodescanner.DefaultDecoderFactory;
import com.journeyapps.barcodescanner.DecoratedBarcodeView;

import java.util.Collections;
import java.util.List;

public final class ScannerActivity extends Activity {
    public static final String EXTRA_RESULT = "codex_bridge_scan_result";
    private static final int CAMERA_PERMISSION_REQUEST = 73;
    private static final String TAG = "CodexBridgeScanner";

    private DecoratedBarcodeView scanner;
    private boolean scannerStarted;
    private boolean finished;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        scanner = new DecoratedBarcodeView(this);
        scanner.setStatusText(getString(R.string.scan_pairing_qr));
        scanner.getBarcodeView().setDecoderFactory(
                new DefaultDecoderFactory(Collections.singletonList(BarcodeFormat.QR_CODE))
        );
        setContentView(scanner);
        Log.i(TAG, "scanner activity created");

        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startScanner();
        } else {
            requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_REQUEST);
        }
    }

    private void startScanner() {
        if (scannerStarted || finished) return;
        scannerStarted = true;
        Log.i(TAG, "starting continuous QR decoder");
        scanner.decodeContinuous(new BarcodeCallback() {
            @Override
            public void barcodeResult(BarcodeResult result) {
                if (result == null || result.getText() == null || finished) return;
                Log.i(TAG, "QR decoded; characters=" + result.getText().length());
                runOnUiThread(() -> {
                    if (finished) return;
                    finished = true;
                    Intent data = new Intent().putExtra(EXTRA_RESULT, result.getText());
                    setResult(RESULT_OK, data);
                    finish();
                });
            }

            @Override
            public void possibleResultPoints(List<ResultPoint> resultPoints) {
                if (resultPoints != null && !resultPoints.isEmpty()) {
                    Log.d(TAG, "QR candidate points=" + resultPoints.size());
                }
            }
        });
        scanner.resume();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != CAMERA_PERMISSION_REQUEST) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startScanner();
        } else {
            Toast.makeText(this, R.string.camera_permission_required, Toast.LENGTH_LONG).show();
            setResult(RESULT_CANCELED);
            finish();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (scannerStarted && !finished) scanner.resume();
    }

    @Override
    protected void onPause() {
        if (scanner != null) scanner.pause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (scanner != null) scanner.pause();
        super.onDestroy();
    }
}
