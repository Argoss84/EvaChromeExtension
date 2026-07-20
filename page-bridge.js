(() => {
  if (window.__evassistantBridgeReady) {
    return;
  }

  window.__evassistantBridgeReady = true;

  function relayToMainWorld(payload) {
    return new Promise(resolve => {
      const requestId = crypto.randomUUID();

      const onResponse = event => {
        if (event.detail?.requestId !== requestId) {
          return;
        }

        window.removeEventListener("evassistant-api-response", onResponse);
        resolve(event.detail.response);
      };

      window.addEventListener("evassistant-api-response", onResponse);
      window.dispatchEvent(new CustomEvent("evassistant-api-request", {
        detail: { requestId, payload }
      }));
    });
  }

  function scrollToSessionOnPage(hints) {
    return new Promise(resolve => {
      const requestId = crypto.randomUUID();

      const onResponse = event => {
        if (event.detail?.requestId !== requestId) {
          return;
        }

        window.removeEventListener("evassistant-scroll-to-session-response", onResponse);
        resolve(Boolean(event.detail.scrolled));
      };

      window.addEventListener("evassistant-scroll-to-session-response", onResponse);
      window.dispatchEvent(new CustomEvent("evassistant-scroll-to-session", {
        detail: { requestId, hints }
      }));
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "evassistant-get-access-token") {
      sendResponse({
        accessToken: document.documentElement.dataset.evassistantToken || null
      });
      return false;
    }

    if (message?.type === "evassistant-scroll-to-session") {
      scrollToSessionOnPage(message.payload?.hints ?? {})
        .then(scrolled => sendResponse({ scrolled }))
        .catch(() => sendResponse({ scrolled: false }));

      return true;
    }

    if (message?.type !== "evassistant-api-request") {
      return false;
    }

    relayToMainWorld(message.payload ?? {})
      .then(response => sendResponse(response))
      .catch(error => {
        sendResponse({
          ok: false,
          status: 0,
          error: String(error?.message ?? error)
        });
      });

    return true;
  });
})();
