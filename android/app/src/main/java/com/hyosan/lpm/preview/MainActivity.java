package com.hyosan.lpm.preview;

import android.app.Activity;
import android.os.Bundle;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.graphics.Color;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.view.Gravity;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.browser.customtabs.CustomTabColorSchemeParams;

/** Browser-owned authentication; this app never reads passwords or cookies. */
public final class MainActivity extends Activity {
    private static final Uri SITE = Uri.parse("https://hyosan-lpm.chae-ni.chatgpt.site/");
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setPadding(32, 64, 32, 32);
        TextView title = new TextView(this);
        title.setText("HYOSAN LPL\n효산 패턴 라이브러리");
        title.setTextSize(24); title.setGravity(Gravity.CENTER);
        layout.addView(title);
        Button open = new Button(this); open.setText("라이브러리 열기");
        open.setOnClickListener(v -> openSite()); layout.addView(open);
        setContentView(layout);
        if (state == null) openSite();
    }
    private void openSite() {
        try {
            CustomTabsIntent tab = new CustomTabsIntent.Builder()
                .setDefaultColorSchemeParams(new CustomTabColorSchemeParams.Builder().setToolbarColor(Color.WHITE).build())
                .setShowTitle(true).build();
            tab.launchUrl(this, SITE);
        } catch (ActivityNotFoundException e) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, SITE)); }
            catch (ActivityNotFoundException missing) {
                new android.app.AlertDialog.Builder(this).setMessage("Chrome 또는 삼성 인터넷을 설치한 뒤 다시 열어 주세요.").setPositiveButton("확인", null).show();
            }
        }
    }
}
