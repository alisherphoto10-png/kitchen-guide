package com.kitchendesk.app;

import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.CookieManager;
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
    super.onCreate(savedInstanceState);
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

  @Override
  public void onPause() {
    super.onPause();
    CookieManager.getInstance().flush();
  }
}
