package com.kitchendesk.app;

import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.CookieManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Запрет скриншотов и записи экрана (данные заведения — не для
    // сохранения). Заодно скрывает содержимое в превью списка
    // недавних приложений. До super.onCreate(), чтобы применилось до
    // отрисовки окна.
    getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
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
  }

  @Override
  public void onPause() {
    super.onPause();
    CookieManager.getInstance().flush();
  }
}
