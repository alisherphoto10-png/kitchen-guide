package com.kitchendesk.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.view.View;
import android.widget.RemoteViews;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

// Виджет «Моя сводка» 4×2 на главном экране (2026-10-16, план утверждён владельцем).
//
// Данные — GET https://kitchendesk.chefplan.ru/api/widget/digest с отдельным ключом
// виджета (backend src/api/widget.js), не с входом сайта. Ключ кладёт сайт через
// AppShell.setWidgetKey, когда суперадмин нажимает «Добавить виджет» в Профиле.
//
// Когда обновляется:
//   • тихий пуш с сервера, как только сводка изменилась (KdMessagingService);
//   • WorkManager раз в 15 минут — подстраховка (чаще Android не даёт);
//   • нажатие на дату в виджете и каждый раз, когда открывают приложение.
//
// Всё сохраняется в SharedPreferences "kd_widget" (в резервную копию не попадает,
// см. res/xml/kd_backup_rules.xml): key, data (последний ответ), fetched_at, state.
public class DigestWidget extends AppWidgetProvider {
  static final String PREFS = "kd_widget";
  static final String URL = "https://kitchendesk.chefplan.ru/api/widget/digest";
  static final String ACTION_REFRESH = "com.kitchendesk.app.WIDGET_REFRESH";
  private static final String WORK_PERIODIC = "kd_widget_periodic";
  private static final String WORK_NOW = "kd_widget_now";

  private static final int[] ROW = { R.id.w_row1, R.id.w_row2, R.id.w_row3 };
  private static final int[] DOT = { R.id.w_dot1, R.id.w_dot2, R.id.w_dot3 };
  private static final int[] ICON = { R.id.w_icon1, R.id.w_icon2, R.id.w_icon3 };
  private static final int[] TITLE = { R.id.w_title1, R.id.w_title2, R.id.w_title3 };
  private static final int[] TEXT = { R.id.w_text1, R.id.w_text2, R.id.w_text3 };
  private static final int[] TIME = { R.id.w_time1, R.id.w_time2, R.id.w_time3 };

  private static final int C_BAD = 0xFFEE5A64, C_WARN = 0xFFE2A03F, C_OK = 0xFF3DBE7A, C_INFO = 0xFF6F9BFF, C_DIM = 0xFF98A2B6;
  private static final Locale RU = new Locale("ru");

  @Override
  public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
    render(ctx);
    schedulePeriodic(ctx);
    refreshNow(ctx);
  }

  @Override
  public void onEnabled(Context ctx) {
    schedulePeriodic(ctx);
  }

  @Override
  public void onDisabled(Context ctx) {
    try { WorkManager.getInstance(ctx).cancelUniqueWork(WORK_PERIODIC); } catch (Exception ignored) { }
  }

  @Override
  public void onReceive(Context ctx, Intent intent) {
    super.onReceive(ctx, intent);
    if (ACTION_REFRESH.equals(intent.getAction())) {
      prefs(ctx).edit().putString("status_note", "обновляю…").apply();
      render(ctx);
      refreshNow(ctx);
    }
  }

  // ---------- когда обновлять ----------
  static boolean hasWidgets(Context ctx) {
    try {
      return AppWidgetManager.getInstance(ctx).getAppWidgetIds(new ComponentName(ctx, DigestWidget.class)).length > 0;
    } catch (Exception e) { return false; }
  }

  private static Constraints online() {
    return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
  }

  static void refreshNow(Context ctx) {
    if (!hasWidgets(ctx)) return;
    try {
      WorkManager.getInstance(ctx).enqueueUniqueWork(WORK_NOW, ExistingWorkPolicy.KEEP,
        new OneTimeWorkRequest.Builder(DigestWorker.class).setConstraints(online()).build());
    } catch (Exception ignored) { }
  }

  static void schedulePeriodic(Context ctx) {
    try {
      WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(WORK_PERIODIC, ExistingPeriodicWorkPolicy.KEEP,
        new PeriodicWorkRequest.Builder(DigestWorker.class, 15, TimeUnit.MINUTES).setConstraints(online()).build());
    } catch (Exception ignored) { }
  }

  static SharedPreferences prefs(Context ctx) {
    return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  // ---------- отрисовка ----------
  static void render(Context ctx) {
    try {
      AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
      int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, DigestWidget.class));
      if (ids.length == 0) return;
      RemoteViews v = build(ctx);
      for (int id : ids) mgr.updateAppWidget(id, v);
    } catch (Exception ignored) { }
  }

  private static RemoteViews build(Context ctx) {
    RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.kd_digest_widget);
    SharedPreferences p = prefs(ctx);

    // дата — по часам телефона: виджет заменяет календарь
    Date now = new Date();
    v.setTextViewText(R.id.w_day, new SimpleDateFormat("d", RU).format(now));
    v.setTextViewText(R.id.w_weekday, new SimpleDateFormat("EEEE", RU).format(now));
    v.setTextViewText(R.id.w_month, new SimpleDateFormat("d MMMM", RU).format(now).replaceFirst("^\\d+\\s*", ""));

    v.setOnClickPendingIntent(R.id.w_root, openApp(ctx));
    v.setOnClickPendingIntent(R.id.w_header, refreshIntent(ctx));

    String state = p.getString("state", "");
    JSONObject data = null;
    try { String raw = p.getString("data", null); if (raw != null) data = new JSONObject(raw); } catch (Exception ignored) { }

    for (int i = 0; i < ROW.length; i++) v.setViewVisibility(ROW[i], View.GONE);
    v.setViewVisibility(R.id.w_empty, View.VISIBLE);

    if (p.getString("key", null) == null) {
      v.setTextViewText(R.id.w_decide, "");
      v.setTextViewText(R.id.w_counts, "");
      v.setTextViewText(R.id.w_empty, "revoked".equals(state)
        ? "Ключ виджета отозван.\nKitchenDesk → Профиль → «Добавить виджет»"
        : "Откройте KitchenDesk → Профиль → «Добавить виджет»");
      v.setTextViewText(R.id.w_status, "");
      return v;
    }
    if (data == null) {
      v.setTextViewText(R.id.w_decide, "");
      v.setTextViewText(R.id.w_counts, "");
      v.setTextViewText(R.id.w_empty, "offline".equals(state) ? "Нет связи с KitchenDesk" : "Загружаю сводку…");
      v.setTextViewText(R.id.w_status, "");
      return v;
    }

    JSONObject counts = data.optJSONObject("counts");
    int decide = counts != null ? counts.optInt("decide") : 0;
    v.setTextViewText(R.id.w_decide, "решить " + decide);
    v.setTextColor(R.id.w_decide, decide > 0 ? C_BAD : C_DIM);
    v.setTextViewText(R.id.w_counts, counts == null ? "" :
      "сегодня " + counts.optInt("today") + " · завтра " + counts.optInt("tomorrow"));

    JSONArray top = data.optJSONArray("top");
    int n = top == null ? 0 : Math.min(top.length(), ROW.length);
    for (int i = 0; i < n; i++) {
      JSONObject it = top.optJSONObject(i);
      if (it == null) continue;
      v.setViewVisibility(ROW[i], View.VISIBLE);
      v.setTextColor(DOT[i], levelColor(it.optString("level")));
      v.setTextViewText(ICON[i], it.optString("icon", "•"));
      v.setTextViewText(TITLE[i], it.optString("title"));
      String text = it.optString("text");
      v.setTextViewText(TEXT[i], text);
      v.setViewVisibility(TEXT[i], text.isEmpty() ? View.GONE : View.VISIBLE);
      v.setTextViewText(TIME[i], ago(it.optString("at", null)));
      String tg = it.optString("tg", "");
      v.setOnClickPendingIntent(ROW[i], safeTg(tg) ? openUrl(ctx, tg, 100 + i) : openApp(ctx));
    }
    if (n > 0) v.setViewVisibility(R.id.w_empty, View.GONE);
    else v.setTextViewText(R.id.w_empty, "Ничего не ждёт — можно выдохнуть");

    String note = p.getString("status_note", null);
    long at = p.getLong("fetched_at", 0);
    String hhmm = at > 0 ? new SimpleDateFormat("HH:mm", RU).format(new Date(at)) : "—";
    v.setTextViewText(R.id.w_status, note != null ? note
      : "offline".equals(state) ? "нет связи · данные на " + hhmm : "обновлено " + hhmm);
    return v;
  }

  private static int levelColor(String level) {
    switch (level) {
      case "bad": return C_BAD;
      case "warn": return C_WARN;
      case "ok": return C_OK;
      default: return C_INFO;
    }
  }

  // «25 мин», «3 ч», «вчера», «4 д» — от времени последнего сообщения
  static String ago(String iso) {
    if (iso == null || iso.length() < 19) return "";
    try {
      SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
      f.setTimeZone(TimeZone.getTimeZone("UTC"));
      long min = (System.currentTimeMillis() - f.parse(iso.substring(0, 19)).getTime()) / 60000;
      if (min < 1) return "сейчас";
      if (min < 60) return min + " мин";
      if (min < 24 * 60) return (min / 60) + " ч";
      if (min < 48 * 60) return "вчера";
      return (min / (24 * 60)) + " д";
    } catch (Exception e) { return ""; }
  }

  // ---------- нажатия ----------
  private static int immutable() {
    return PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
  }

  private static PendingIntent openApp(Context ctx) {
    Intent i = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    return PendingIntent.getActivity(ctx, 1, i, immutable());
  }

  private static PendingIntent refreshIntent(Context ctx) {
    Intent i = new Intent(ctx, DigestWidget.class).setAction(ACTION_REFRESH);
    return PendingIntent.getBroadcast(ctx, 2, i, immutable());
  }

  // только чат в Telegram — никакие другие адреса из ответа сервера не открываем
  private static boolean safeTg(String url) {
    return url != null && (url.matches("^https://t\\.me/[A-Za-z][A-Za-z0-9_]{3,}$") || url.matches("^tg://user\\?id=\\d+$"));
  }

  private static PendingIntent openUrl(Context ctx, String url, int code) {
    Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url)).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    return PendingIntent.getActivity(ctx, code, i, immutable());
  }
}
