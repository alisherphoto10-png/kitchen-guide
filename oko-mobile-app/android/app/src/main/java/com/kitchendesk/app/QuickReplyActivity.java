package com.kitchendesk.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

// Окно быстрого ответа поставщику поверх главного экрана (2026-10-16): нажали строку
// поставщика в виджете → здесь его последнее сообщение и готовые фразы. Нажатие на
// фразу сразу отправляет её с Telegram-аккаунта поставщиков (POST /api/widget/reply,
// ключ виджета; сервер принимает только фразы из своего списка и только тем, кто
// сейчас в «Ждёт решения»). Приложение при этом не открывается.
public class QuickReplyActivity extends Activity {
  static final String EXTRA_CHAT = "chat_id", EXTRA_TITLE = "title", EXTRA_TEXT = "text", EXTRA_TG = "tg";
  private static final String REPLY_URL = "https://kitchendesk.chefplan.ru/api/widget/reply";

  private final Handler ui = new Handler(Looper.getMainLooper());
  private final List<TextView> buttons = new ArrayList<>();
  private TextView status;
  private boolean sending;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    requestWindowFeature(Window.FEATURE_NO_TITLE);
    Intent in = getIntent();
    String chatId = in.getStringExtra(EXTRA_CHAT);
    String key = DigestWidget.prefs(this).getString("key", null);
    if (chatId == null || key == null) { finish(); return; }

    LinearLayout col = new LinearLayout(this);
    col.setOrientation(LinearLayout.VERTICAL);
    col.setBackgroundResource(R.drawable.kd_widget_bg);
    int pad = dp(20);
    col.setPadding(pad, dp(18), pad, dp(14));

    TextView title = text(in.getStringExtra(EXTRA_TITLE), 17, 0xFFE8ECF4, true);
    col.addView(title);
    String last = in.getStringExtra(EXTRA_TEXT);
    if (!TextUtils.isEmpty(last)) {
      TextView quote = text("«" + last + "»", 14, 0xFF98A2B6, false);
      quote.setMaxLines(4);
      quote.setEllipsize(TextUtils.TruncateAt.END);
      quote.setPadding(0, dp(6), 0, 0);
      col.addView(quote);
    }

    TextView hint = text("Ответить одним нажатием — уйдёт сразу:", 12, 0xFF6B7589, false);
    hint.setPadding(0, dp(14), 0, dp(4));
    col.addView(hint);

    for (String[] p : phrases()) {
      TextView b = text(p[1], 15, 0xFFE8ECF4, true);
      b.setGravity(Gravity.CENTER);
      b.setBackgroundResource(R.drawable.kd_qr_chip);
      b.setClickable(true);
      b.setFocusable(true);
      b.setOnClickListener(v -> send(key, chatId, p[0], p[1]));
      LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(44));
      lp.topMargin = dp(8);
      col.addView(b, lp);
      buttons.add(b);
    }

    status = text("", 13, 0xFF98A2B6, false);
    status.setGravity(Gravity.CENTER);
    status.setPadding(0, dp(10), 0, 0);
    col.addView(status);

    LinearLayout bottom = new LinearLayout(this);
    bottom.setOrientation(LinearLayout.HORIZONTAL);
    bottom.setGravity(Gravity.END);
    bottom.setPadding(0, dp(8), 0, 0);
    String tg = in.getStringExtra(EXTRA_TG);
    if (DigestWidget.safeTg(tg)) bottom.addView(link("Открыть Telegram", v -> openTg(tg)));
    bottom.addView(link("Закрыть", v -> finish()));
    col.addView(bottom);

    ScrollView scroll = new ScrollView(this);
    scroll.addView(col);
    setContentView(scroll);
    Window w = getWindow();
    w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
    w.setLayout((int) (getResources().getDisplayMetrics().widthPixels * 0.9), ViewGroup.LayoutParams.WRAP_CONTENT);
  }

  // фразы приходят с сервера вместе со сводкой; нет — запасной набор
  private List<String[]> phrases() {
    List<String[]> out = new ArrayList<>();
    try {
      JSONArray arr = new JSONObject(DigestWidget.prefs(this).getString("data", "{}")).optJSONArray("replies");
      for (int i = 0; arr != null && i < arr.length(); i++) {
        JSONObject o = arr.optJSONObject(i);
        if (o != null && !o.optString("id").isEmpty()) out.add(new String[] { o.optString("id"), o.optString("text") });
      }
    } catch (Exception ignored) { }
    if (out.isEmpty()) {
      out.add(new String[] { "ok", "Принято" });
      out.add(new String[] { "later", "Уточню и отвечу" });
    }
    return out;
  }

  private void send(String key, String chatId, String phraseId, String phraseText) {
    if (sending) return;
    sending = true;
    for (TextView b : buttons) b.setEnabled(false);
    status.setTextColor(0xFF98A2B6);
    status.setText("Отправляю «" + phraseText + "»…");
    new Thread(() -> {
      String err = null;
      HttpURLConnection c = null;
      try {
        JSONObject body = new JSONObject().put("chat_id", chatId).put("phrase", phraseId);
        c = (HttpURLConnection) new URL(REPLY_URL).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        c.setRequestProperty("X-Widget-Key", key);
        try (OutputStream os = c.getOutputStream()) { os.write(body.toString().getBytes("UTF-8")); }
        int code = c.getResponseCode();
        if (code != 200) {
          String msg = read(c.getErrorStream());
          try { msg = new JSONObject(msg).optString("error", msg); } catch (Exception ignored) { }
          err = code == 401 ? "Ключ виджета отозван — добавьте виджет заново в Профиле"
            : TextUtils.isEmpty(msg) ? "Не отправилось (код " + code + ")" : msg;
        }
      } catch (Exception e) {
        err = "Нет связи с KitchenDesk";
      } finally {
        if (c != null) c.disconnect();
      }
      final String error = err;
      ui.post(() -> {
        if (isFinishing()) return;
        if (error == null) {
          status.setTextColor(0xFF3DBE7A);
          status.setText("Отправлено ✓");
          DigestWidget.refreshNow(getApplicationContext());
          ui.postDelayed(this::finish, 900);
        } else {
          sending = false;
          for (TextView b : buttons) b.setEnabled(true);
          status.setTextColor(0xFFEE5A64);
          status.setText(error);
        }
      });
    }).start();
  }

  private static String read(InputStream s) {
    if (s == null) return "";
    StringBuilder sb = new StringBuilder();
    try (BufferedReader r = new BufferedReader(new InputStreamReader(s, "UTF-8"))) {
      String line;
      while ((line = r.readLine()) != null) sb.append(line);
    } catch (Exception ignored) { }
    return sb.toString();
  }

  private void openTg(String url) {
    try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) { }
    finish();
  }

  private TextView text(String s, int sp, int color, boolean bold) {
    TextView t = new TextView(this);
    t.setText(s == null ? "" : s);
    t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
    t.setTextColor(color);
    if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
    return t;
  }

  private TextView link(String s, android.view.View.OnClickListener l) {
    TextView t = text(s, 14, 0xFF6F9BFF, true);
    t.setPadding(dp(14), dp(10), 0, dp(6));
    t.setClickable(true);
    t.setOnClickListener(l);
    return t;
  }

  private int dp(int v) {
    return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
  }
}
