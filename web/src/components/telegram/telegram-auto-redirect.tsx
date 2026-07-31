"use client";

import { useEffect } from "react";

const CABINET_PATH = "/cabinet/";
const DELAYED_CHECK_MS = 800;

function redirectToCabinet() {
  window.location.replace(`${CABINET_PATH}${window.location.search}`);
}

/**
 * Existing production links (bot buttons, saved sessions, the Telegram menu
 * button) point at the bare domain. This mirrors the old root page's
 * detection so those links keep landing in the cabinet instead of the
 * marketing homepage.
 */
export function TelegramAutoRedirect() {
  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (webApp) {
      webApp.ready();
      webApp.expand();
    }

    const params = new URLSearchParams(window.location.search);
    const hasDemoToken = !!params.get("demo_token");
    const hasSavedSession = !!window.localStorage.getItem("web_token");

    if (webApp?.initData || hasDemoToken || hasSavedSession) {
      redirectToCabinet();
      return;
    }

    const delayedCheck = window.setTimeout(() => {
      const delayedInitData = window.Telegram?.WebApp?.initData;
      if (delayedInitData || window.localStorage.getItem("web_token")) {
        redirectToCabinet();
      }
    }, DELAYED_CHECK_MS);

    return () => window.clearTimeout(delayedCheck);
  }, []);

  return null;
}
