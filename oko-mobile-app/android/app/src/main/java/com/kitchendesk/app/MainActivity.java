package com.kitchendesk.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Logger;
import java.lang.reflect.Method;
import java.util.Collections;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Запрет скриншотов (FLAG_SECURE) временно отключён — мешает
    // самим же снимать экран во время доработки. Включить обратно
    // одной строкой перед реальным использованием:
    // getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
    registerPlugin(AppShellPlugin.class);
    super.onCreate(savedInstanceState);
    createPushChannel();
    // На одном из двух тестовых устройств вход на сайте не переживал
    // закрытие приложения (куки не сохранялись между запусками), хотя
    // на другом всё работало на том же коде — похоже на особенность
    // конкретного WebView/прошивки, не на баг самого приложения. Явно
    // включаем приём кук (в т.ч. сторонних, если сайт их использует
    // при входе) и сбрасываем на диск сразу и при каждом уходе в фон.
    CookieManager cookieManager = CookieManager.getInstance();
    cookieManager.setAcceptCookie(true);
    cookieManager.setAcceptThirdPartyCookies(getBridge().getWebView(), true);
    cookieManager.flush();
    injectBridgeIntoSite();
  }

  // Сайт KitchenDesk, который приложение открывает после онбординга. Только он
  // (точный адрес, без масок вроде *.chefplan.ru) получает доступ к нативным
  // плагинам. Решение пользователя 2026-09-29: компромисс принят — при XSS на
  // сайте чужой скрипт смог бы вызывать плагины приложения (сейчас App и
  // PushNotifications); новые плагины добавлять с оглядкой на это.
  private static final String SITE_ORIGIN = "https://kitchendesk.chefplan.ru";

  // Capacitor подмешивает свой JS (мост + список плагинов) только в страницы
  // самого приложения (https://localhost); на домены из allowNavigation
  // пробрасывается лишь низкоуровневый канал androidBridge, без плагинов —
  // из-за этого на /web не было PushNotifications (найдено 2026-09-29 на живом
  // тесте push). Добавляем тот же скрипт и для сайта. JSInjector в Capacitor
  // закрыт, поэтому берём его через reflection у Bridge (Capacitor 6.x).
  private void injectBridgeIntoSite() {
    try {
      if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
        Logger.warn("KitchenDesk: DOCUMENT_START_SCRIPT не поддерживается — плагины на сайте недоступны");
        return;
      }
      Bridge bridge = getBridge();
      Method getInjector = Bridge.class.getDeclaredMethod("getJSInjector");
      getInjector.setAccessible(true);
      Object injector = getInjector.invoke(bridge);
      if (injector == null) return;
      Method getScript = injector.getClass().getMethod("getScriptString");
      getScript.setAccessible(true);
      String script = (String) getScript.invoke(injector);
      WebViewCompat.addDocumentStartJavaScript(bridge.getWebView(), script, Collections.singleton(SITE_ORIGIN));
    } catch (Exception e) {
      Logger.error("KitchenDesk: не удалось подключить мост Capacitor к сайту", e);
    }
  }

  // ---------- Звук push-уведомлений (2026-09-29) ----------
  // Канал с нашим звуком res/raw/kd_notification.mp3. Сервер шлёт пуши в
  // kd_events_v2 (backend src/push/index.js). Звук у существующего канала
  // Android поменять не даёт, поэтому новый id, а старый kd_events (системный
  // звук) удаляем. Создаём один раз: если сотрудник потом сам сменит звук в
  // настройках телефона — не перетираем.
  static final String PUSH_CHANNEL_ID = "kd_events_v2";

  private void createPushChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    try {
      SharedPreferences prefs = getSharedPreferences("kd_app", Context.MODE_PRIVATE);
      if (prefs.getBoolean("push_channel_v2_created", false)) return;
      NotificationManager nm = getSystemService(NotificationManager.class);
      // Если канал успела создать без звука старая версия сайта — пересоздаём.
      nm.deleteNotificationChannel(PUSH_CHANNEL_ID);
      NotificationChannel ch = new NotificationChannel(PUSH_CHANNEL_ID, "События KitchenDesk", NotificationManager.IMPORTANCE_HIGH);
      ch.setDescription("Акты, списания, напоминания, ТТК");
      ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
      Uri sound = Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.kd_notification);
      ch.setSound(sound, new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build());
      nm.createNotificationChannel(ch);
      nm.deleteNotificationChannel("kd_events");
      prefs.edit().putBoolean("push_channel_v2_created", true).apply();
    } catch (Exception e) {
      Logger.error("KitchenDesk: не удалось создать канал уведомлений", e);
    }
  }

  // ---------- Заставка перехода (2026-09-29) ----------
  // Переход с экрана входа (https://localhost) на сайт и обратно — полная
  // перезагрузка страницы в WebView, её не анимировать: кадр рвётся, вёрстка
  // дёргается. Поэтому на время перехода поверх WebView лежит нативная
  // заставка — тот же логотип и полоса загрузки, что на последнем экране
  // входа (www/index.html, #loaderScreen), — и плавно гаснет, когда сайт
  // отрисовался (AppShell.hideLoader). Не дождались за 10 с — гасим сами.
  private FrameLayout loader;
  private final Handler ui = new Handler(Looper.getMainLooper());
  private final Runnable loaderTimeout = this::hideLoader;

  void showLoader() {
    runOnUiThread(() -> {
      ensureLoader();
      ui.removeCallbacks(loaderTimeout);
      ui.postDelayed(loaderTimeout, 10000);
      loader.animate().cancel();
      if (loader.getVisibility() != View.VISIBLE) {
        loader.setAlpha(0f);
        loader.setVisibility(View.VISIBLE);
      }
      loader.animate().alpha(1f).setDuration(120).start();
    });
  }

  void hideLoader() {
    runOnUiThread(() -> {
      ui.removeCallbacks(loaderTimeout);
      if (loader == null || loader.getVisibility() != View.VISIBLE) return;
      loader.animate().cancel();
      loader.animate().alpha(0f).setDuration(380).withEndAction(() -> loader.setVisibility(View.GONE)).start();
    });
  }

  private void ensureLoader() {
    if (loader != null) return;
    float d = getResources().getDisplayMetrics().density;
    loader = new FrameLayout(this);
    loader.setBackgroundColor(0xFF070B12);
    loader.setClickable(true); // пока заставка на экране — касания не уходят в страницу под ней
    LinearLayout col = new LinearLayout(this);
    col.setOrientation(LinearLayout.VERTICAL);
    col.setGravity(Gravity.CENTER_HORIZONTAL);
    ImageView logo = new ImageView(this);
    logo.setImageResource(R.drawable.kd_logo);
    logo.setAdjustViewBounds(true);
    col.addView(logo, new LinearLayout.LayoutParams((int) (120 * d), ViewGroup.LayoutParams.WRAP_CONTENT));
    LinearLayout.LayoutParams barLp = new LinearLayout.LayoutParams((int) (120 * d), Math.max(1, (int) (2 * d)));
    barLp.topMargin = (int) (28 * d);
    col.addView(new LoadingBar(this), barLp);
    loader.addView(col, new FrameLayout.LayoutParams(
      ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
    loader.setVisibility(View.GONE);
    addContentView(loader, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
  }

  // Полоса загрузки: бегущий отрезок 40% ширины, 1.2 с — как .kd-bar в www/index.html.
  private static class LoadingBar extends View {
    private final Paint track = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF r = new RectF();

    LoadingBar(Context c) {
      super(c);
      track.setColor(0x294D7FFF);
      fill.setColor(0xFF4D7FFF);
    }

    @Override
    protected void onDraw(Canvas canvas) {
      float w = getWidth(), h = getHeight(), rad = h / 2f;
      canvas.save();
      canvas.clipRect(0, 0, w, h);
      r.set(0, 0, w, h);
      canvas.drawRoundRect(r, rad, rad, track);
      float t = (SystemClock.uptimeMillis() % 1200) / 1200f;
      float x = -0.4f * w + t * 1.4f * w;
      r.set(x, 0, x + 0.4f * w, h);
      canvas.drawRoundRect(r, rad, rad, fill);
      canvas.restore();
      postInvalidateOnAnimation();
    }
  }

  @Override
  public void onPause() {
    super.onPause();
    CookieManager.getInstance().flush();
  }
}
