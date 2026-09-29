package com.kitchendesk.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Нативная заставка перехода (логотип + полоса загрузки) поверх WebView —
// см. MainActivity.showLoader/hideLoader. Вызывают экран входа приложения
// (www/index.html) перед переходом на сайт и сайт /web (utils/appShell.ts),
// когда отрисовался. Доступен и сайту kitchendesk.chefplan.ru (мост туда
// подключает MainActivity) — умеет только показать/спрятать заставку.
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
}
