(() => {
  if (window.__evassistantApiMainReady) {
    return;
  }

  window.__evassistantApiMainReady = true;

  const API_URL = "https://api.eva.gg/graphql";
  const REFRESH_TOKEN_QUERY = `
    mutation refreshToken {
      refreshToken {
        accessToken
      }
    }
  `;

  function storeToken(token) {
    if (!token) {
      return;
    }

    document.documentElement.dataset.evassistantToken = token;
  }

  function getAccessTokenFromPage() {
    return document.documentElement.dataset.evassistantToken || null;
  }

  if (!window.__evassistantTokenHookReady) {
    window.__evassistantTokenHookReady = true;

    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      const init = args[1] ?? {};
      const headers = init.headers;

      if (headers instanceof Headers) {
        const auth = headers.get("authorization") ?? headers.get("Authorization");
        if (auth?.startsWith("Bearer ")) {
          storeToken(auth.slice(7));
        }
      } else if (headers) {
        const auth = headers.authorization ?? headers.Authorization;
        if (typeof auth === "string" && auth.startsWith("Bearer ")) {
          storeToken(auth.slice(7));
        }
      }

      return originalFetch.apply(this, args);
    };
  }

  function getEvaClientHeaders(accessToken) {
    const appCommit = document.querySelector('meta[name="version"]')?.content?.trim() ?? "";
    const headers = {
      "accept": "*/*",
      "content-type": "application/json",
      "eva-client-app-name": "spa-app"
    };

    if (appCommit) {
      headers["eva-client-app-commit"] = appCommit;
    }

    if (accessToken) {
      headers.authorization = `Bearer ${accessToken}`;
      headers["x-access-token"] = accessToken;
    }

    return headers;
  }

  async function refreshAccessToken() {
    const response = await fetch(API_URL, {
      method: "POST",
      credentials: "include",
      headers: getEvaClientHeaders(),
      body: JSON.stringify({
        operationName: "refreshToken",
        variables: {},
        query: REFRESH_TOKEN_QUERY
      })
    });

    const json = await response.json();
    const token = json?.data?.refreshToken?.accessToken ?? null;

    if (token) {
      storeToken(token);
    }

    return token;
  }

  async function resolveAccessToken(payload) {
    if (payload.authMode === "none") {
      return null;
    }

    if (payload.authMode === "explicit") {
      return payload.accessToken ?? null;
    }

    return payload.accessToken ?? getAccessTokenFromPage() ?? await refreshAccessToken();
  }

  async function executeRequest(payload) {
    const { operationName, variables, query } = payload ?? {};
    const accessToken = await resolveAccessToken(payload);

    const response = await fetch(API_URL, {
      method: "POST",
      credentials: "include",
      headers: getEvaClientHeaders(accessToken),
      body: JSON.stringify({
        operationName,
        variables,
        query
      })
    });

    let json = null;
    try {
      json = await response.json();
    } catch (_) {
      json = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      json
    };
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function normalizeText(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function extractTimeFromLocalDatetime(localDatetime) {
    if (!localDatetime) {
      return "";
    }

    const match = String(localDatetime).match(/T(\d{2}:\d{2})/);
    return match?.[1] ?? "";
  }

  function buildTimeCandidates(hints = {}) {
    const candidates = new Set();

    for (const value of [hints.convocationTime, hints.startTime, extractTimeFromLocalDatetime(hints.localDatetime)]) {
      if (value) {
        candidates.add(String(value).trim());
      }
    }

    return [...candidates];
  }

  function cardMatchesGame(card, gameName) {
    if (!gameName) {
      return true;
    }

    const cardText = normalizeText(card.textContent ?? "");
    const imageAlt = normalizeText(card.querySelector("img")?.alt ?? "");

    return cardText.includes(gameName) || imageAlt.includes(gameName);
  }

  function cardMatchesTime(card, timeCandidates) {
    if (!timeCandidates.length) {
      return true;
    }

    const cardTime = card.getAttribute("data-test-time") ?? "";
    const cardText = card.textContent ?? "";

    if (timeCandidates.includes(cardTime)) {
      return true;
    }

    return timeCandidates.some(time => cardText.includes(time));
  }

  function findSessionCardElement(hints = {}) {
    const gameName = normalizeText(hints.gameName);
    const timeCandidates = buildTimeCandidates(hints);
    const testCards = document.querySelectorAll('[data-test="session-card"]');

    for (const card of testCards) {
      if (cardMatchesGame(card, gameName) && cardMatchesTime(card, timeCandidates)) {
        return card;
      }
    }

    for (const card of testCards) {
      const cardText = normalizeText(card.textContent ?? "");
      if (cardMatchesGame(card, gameName) && cardText.includes("reserve")) {
        return card;
      }
    }

    if (gameName) {
      for (const card of testCards) {
        if (cardMatchesGame(card, gameName)) {
          return card;
        }
      }
    }

    const legacyCards = document.querySelectorAll('[class*="sessionCard"]');

    for (const card of legacyCards) {
      if (cardMatchesGame(card, gameName) && cardMatchesTime(card, timeCandidates)) {
        return card;
      }
    }

    return null;
  }

  function centerElementInViewport(element) {
    element.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });

    let parent = element.parentElement;

    while (parent) {
      const style = window.getComputedStyle(parent);
      const scrollable = /(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight;

      if (scrollable) {
        const parentRect = parent.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const offset = elementRect.top - parentRect.top - (parentRect.height / 2) + (elementRect.height / 2);
        parent.scrollTop += offset;
      }

      parent = parent.parentElement;
    }
  }

  async function scrollToSession(hints = {}) {
    const maxWaitMs = 45000;
    const startedAt = Date.now();

    const tryCenter = () => {
      const card = findSessionCardElement(hints);
      if (!card) {
        return null;
      }

      centerElementInViewport(card);
      return card;
    };

    let card = tryCenter();

    while (!card && Date.now() - startedAt < maxWaitMs) {
      await new Promise(resolve => {
        const remaining = maxWaitMs - (Date.now() - startedAt);
        const timeout = setTimeout(() => {
          observer.disconnect();
          resolve();
        }, Math.min(500, remaining));

        const observer = new MutationObserver(() => {
          card = tryCenter();
          if (card) {
            clearTimeout(timeout);
            observer.disconnect();
            resolve();
          }
        });

        observer.observe(document.documentElement, { childList: true, subtree: true });

        card = tryCenter();
        if (card) {
          clearTimeout(timeout);
          observer.disconnect();
          resolve();
        }
      });

      if (!card) {
        await sleep(300);
        card = tryCenter();
      }
    }

    if (!card) {
      return false;
    }

    const recenter = () => {
      const currentCard = findSessionCardElement(hints);
      if (currentCard) {
        centerElementInViewport(currentCard);
      }
    };

    await sleep(800);
    recenter();
    await sleep(1200);
    recenter();
    await sleep(2000);
    recenter();

    return Boolean(findSessionCardElement(hints));
  }

  window.addEventListener("evassistant-api-request", async event => {
    const { requestId, payload } = event.detail ?? {};

    try {
      const response = await executeRequest(payload);
      window.dispatchEvent(new CustomEvent("evassistant-api-response", {
        detail: { requestId, response }
      }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent("evassistant-api-response", {
        detail: {
          requestId,
          response: {
            ok: false,
            status: 0,
            error: String(error?.message ?? error)
          }
        }
      }));
    }
  });

  window.addEventListener("evassistant-scroll-to-session", async event => {
    const { requestId, hints } = event.detail ?? {};

    try {
      const scrolled = await scrollToSession(hints ?? {});
      window.dispatchEvent(new CustomEvent("evassistant-scroll-to-session-response", {
        detail: { requestId, scrolled }
      }));
    } catch (_) {
      window.dispatchEvent(new CustomEvent("evassistant-scroll-to-session-response", {
        detail: { requestId, scrolled: false }
      }));
    }
  });

  function bootstrapPendingScroll() {
    try {
      const raw = sessionStorage.getItem("evassistant-pending-scroll");
      if (!raw) {
        return;
      }

      sessionStorage.removeItem("evassistant-pending-scroll");
      const hints = JSON.parse(raw);
      scrollToSession(hints).catch(() => {});
    } catch (_) {
      // Ignore invalid pending scroll payload.
    }
  }

  if (location.hostname === "app.eva.gg") {
    bootstrapPendingScroll();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bootstrapPendingScroll, { once: true });
    }
  }
})();
