package com.kitchendesk.app;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONObject;

// Загрузка сводки для виджета (DigestWidget). Всегда успех для WorkManager —
// ошибка сети просто показывается в виджете («нет связи»), периодическая задача
// продолжает работать. 401 — ключ отозван/устройство перепривязано: ключ стираем.
public class DigestWorker extends Worker {
  public DigestWorker(@NonNull Context ctx, @NonNull WorkerParameters params) {
    super(ctx, params);
  }

  @NonNull
  @Override
  public Result doWork() {
    Context ctx = getApplicationContext();
    SharedPreferences p = DigestWidget.prefs(ctx);
    String key = p.getString("key", null);
    if (key == null) {
      DigestWidget.render(ctx);
      return Result.success();
    }
    HttpURLConnection c = null;
    try {
      c = (HttpURLConnection) new URL(DigestWidget.URL).openConnection();
      c.setConnectTimeout(15000);
      c.setReadTimeout(15000);
      c.setRequestProperty("X-Widget-Key", key);
      c.setRequestProperty("Accept", "application/json");
      int code = c.getResponseCode();
      if (code == 200) {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"))) {
          String line;
          while ((line = r.readLine()) != null) sb.append(line);
        }
        new JSONObject(sb.toString()); // мусор не сохраняем
        p.edit().putString("data", sb.toString()).putLong("fetched_at", System.currentTimeMillis())
          .putString("state", "ok").remove("status_note").apply();
      } else if (code == 401) {
        p.edit().remove("key").remove("data").putString("state", "revoked").remove("status_note").apply();
      } else if (code == 429) {
        p.edit().remove("status_note").apply(); // только что обновлялись — оставляем как есть
      } else {
        p.edit().putString("state", "offline").remove("status_note").apply();
      }
    } catch (Exception e) {
      p.edit().putString("state", "offline").remove("status_note").apply();
    } finally {
      if (c != null) c.disconnect();
    }
    DigestWidget.render(ctx);
    return Result.success();
  }
}
