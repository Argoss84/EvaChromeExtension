(() => {
  if (window.__evassistantBridgeReady) {
    return;
  }

  window.__evassistantBridgeReady = true;

  const API_URL = "https://api.eva.gg/graphql";

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "evassistant-api-request") {
      return false;
    }

    const { operationName, variables, query, accessToken, recaptchaToken } = message.payload ?? {};

    fetch(API_URL, {
      method: "POST",
      credentials: "include",
      headers: {
        "accept": "*/*",
        "content-type": "application/json",
        "eva-client-app-name": "spa-app",
        ...(accessToken ? { "authorization": `Bearer ${accessToken}` } : {}),
        ...(operationName === "listParticipants" && recaptchaToken
          ? { "x-recaptcha-token": recaptchaToken }
          : {})
      },
      body: JSON.stringify({
        operationName,
        variables,
        query
      })
    })
      .then(async response => {
        let json = null;
        try {
          json = await response.json();
        } catch (_) {
          json = null;
        }

        sendResponse({
          ok: response.ok,
          status: response.status,
          json
        });
      })
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
