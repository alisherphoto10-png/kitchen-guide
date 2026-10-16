package com.kitchendesk.app;

import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

// Приёмник FCM вместо сервиса плагина Capacitor (тот убран из манифеста через
// tools:node="remove"). Тихий пуш виджета (data kd_widget=1, без notification;
// шлёт backend src/api/widget.js, когда сводка изменилась) — только обновляет
// виджет и дальше не идёт. Все остальные пуши — как раньше, в плагин.
public class KdMessagingService extends MessagingService {
  @Override
  public void onMessageReceived(@NonNull RemoteMessage message) {
    if ("1".equals(message.getData().get("kd_widget"))) {
      DigestWidget.refreshNow(getApplicationContext());
      return;
    }
    super.onMessageReceived(message);
  }
}
