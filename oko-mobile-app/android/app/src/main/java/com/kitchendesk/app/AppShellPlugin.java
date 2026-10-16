package com.kitchendesk.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Нативная заставка перехода (логотип + полоса загрузки) поверх WebView —
// см. MainActivity.showLoader/hideLoader. Вызывают экран входа приложения
// (www/index.html) перед переходом на сайт и сайт /web (utils/appShell.ts),
// когда отрисовался. Доступен и сайту kitchendesk.chefplan.ru (мост туда
// подключает MainActivity).
//
// Виджет «Моя сводка» (2026-10-16): сайт кладёт ключ виджета (setWidgetKey),
// просит Android поставить виджет на экран (pinWidget), узнаёт состояние
// (widgetState) и убирает ключ (clearWidgetKey). Ключ только записывается —
// прочитать его обратно со страницы нельзя (на случай XSS на сайте, см.
// MainActivity.SITE_ORIGIN); адрес сводки зашит в DigestWidget.URL.
@CapacitorPlugin(name = "AppShell")
public class AppShellPlugin extends Plugin {

  @PluginMethod
  public void showLoader(PluginCall call) {
    ((MainActivity) getActivity()).showLoader();
    call.resolve();
  }

  @PluginMethod
  public void hideLoader(PluginCall call) {
    ((MainActivity) getActivity()).hideLoader();
    call.resolve();
  }

  @PluginMethod
  public void setWidgetKey(PluginCall call) {
    String key = call.getString("key", "");
    if (key == null || !key.matches("^kdw_[A-Za-z0-9_-]{43}$")) {
      call.reject("bad_key");
      return;
    }
    Context ctx = getContext();
    DigestWidget.prefs(ctx).edit().putString("key", key).remove("data").remove("state").remove("status_note").apply();
    DigestWidget.render(ctx);
    DigestWidget.schedulePeriodic(ctx);
    DigestWidget.refreshNow(ctx);
    call.resolve();
  }

  @PluginMethod
  public void clearWidgetKey(PluginCall call) {
    Context ctx = getContext();
    DigestWidget.prefs(ctx).edit().clear().apply();
    DigestWidget.render(ctx);
    call.resolve();
  }

  @PluginMethod
  public void widgetState(PluginCall call) {
    Context ctx = getContext();
    JSObject r = new JSObject();
    r.put("hasKey", DigestWidget.prefs(ctx).getString("key", null) != null);
    r.put("installed", DigestWidget.hasWidgets(ctx));
    r.put("pinSupported", pinSupported(ctx));
    call.resolve(r);
  }

  // Android 8+: системное окно «Добавить виджет на главный экран?». Старее или
  // лаунчер не умеет — сайт подсказывает добавить вручную (долгое нажатие → Виджеты).
  @PluginMethod
  public void pinWidget(PluginCall call) {
    Context ctx = getContext();
    JSObject r = new JSObject();
    boolean asked = false;
    if (pinSupported(ctx)) {
      try {
        asked = AppWidgetManager.getInstance(ctx).requestPinAppWidget(new ComponentName(ctx, DigestWidget.class), null, null);
      } catch (Exception ignored) { }
    }
    r.put("asked", asked);
    call.resolve(r);
  }

  private static boolean pinSupported(Context ctx) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
    try { return AppWidgetManager.getInstance(ctx).isRequestPinAppWidgetSupported(); } catch (Exception e) { return false; }
  }
}
