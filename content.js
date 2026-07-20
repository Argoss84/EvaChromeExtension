(function () {
  const API_URL = "https://api.eva.gg/graphql";
  const EVA_APP_ORIGIN = "https://app.eva.gg";
  const PANEL_ID = "evassistant-panel";
  const AUTH_REQUIRED_MESSAGE = "Connecte-toi à ton compte EVA pour utiliser Evassistant.";
  const FAVORITES_STORAGE_KEY = "evassistant_booking_favorites_v1";
  const LEGACY_FAVORITES_STORAGE_KEY = "eva_ext_booking_favorites_v1";

  let cachedAccessToken = null;
  let refreshAccessTokenPromise = null;
  let activeTab = "favorites";
  let activeEvaTabIdCache = null;
  let locationsCache = null;
  const locationGamesCache = new Map();
  const favoriteBuilderState = {
    locationId: "",
    gameId: "",
    seatCount: "",
    label: ""
  };

  const REFRESH_TOKEN_QUERY = `
    mutation refreshToken {
      refreshToken {
        accessToken
      }
    }
  `;

  const BOOKING_QUERY = `
    query getBookingOrderList($page: PageRequestInput, $filters: ListBookingOrdersFiltersInput!) {
      listBookingOrders(page: $page, filters: $filters) {
        nodes {
          id
          items {
            booking {
              id
              terrainId
              seatCount
              status
              orderId
              bookingGroupUnitId
              sessionLink
              slot {
                id
                localDatetime
                startTime
                endTime
                convocationTime
              }
              gameId
              game {
                id
                name
                identifier
              }
              location {
                id
                name
              }
            }
          }
        }
        totalCount
      }
    }
  `;

  const USE_SESSIONS_QUERY = `
    query useSessions($data: ListLocationSessionsByDateInput!) {
      listLocationGameSessionsByDate(data: $data) {
        takenSeatCount
        slot {
          id
          startTime
          localDatetime
          convocationTime
        }
        terrain {
          id
        }
        game {
          id
          name
        }
      }
    }
  `;

  const LIST_LOCATIONS_QUERY = `
    query listLocations($country: CountryEnum!, $sortOrder: SortOrderLocationsInput) {
      listLocations(country: $country, sortOrder: $sortOrder) {
        id
        identifier
        name
        department
        country
        status
      }
    }
  `;

  const GAME_HISTORY_QUERY = `
    query useAfterhGameHistoryPageLastOnly($userId: Int!, $seasonId: Int!) {
      listLastAfterhGameHistoriesByUserAndSeason(userId: $userId, seasonId: $seasonId) {
        id
        createdAt
        data {
          duration
          teamOne {
            score
            name
          }
          teamTwo {
            score
            name
          }
        }
        players {
          userId
          data {
            niceName
            rank
            team
            score
            outcome
            kills
            deaths
            assists
          }
        }
        terrain {
          name
          location {
            name
          }
        }
        map {
          name
        }
        mode {
          identifier
          category
        }
      }
    }
  `;

  const LIST_AFTERH_SEASONS_QUERY = `
    query listAfterhSeasons {
      listAfterhSeasons {
        id
        isCurrent
      }
    }
  `;

  const GET_ME_QUERY = `
    query me {
      me {
        id
      }
    }
  `;

  const BOOKING_LOCATION_QUERY = `
    query Booking($id: Int!) {
      location(id: $id) {
        id
        name
        country
        locationGames {
          maxSeatCount
          game {
            id
            name
            identifier
            minPlayer
            maxPlayer
          }
        }
      }
    }
  `;

  function init() {
    createPanel();
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="evassistant-header">
        <strong id="evassistant-title">Evassistant</strong>
      </div>

      <div class="evassistant-tabs">
        <button class="evassistant-tab active" data-tab="favorites">Favoris</button>
        <button class="evassistant-tab" data-tab="upcoming">À venir</button>
        <button class="evassistant-tab" data-tab="history">Parties</button>
      </div>

      <div id="evassistant-content">Chargement...</div>
    `;

    document.body.appendChild(panel);

    document.querySelectorAll(".evassistant-tab").forEach(button => {
      button.addEventListener("click", () => {
        activeTab = button.dataset.tab;

        document.querySelectorAll(".evassistant-tab").forEach(tab => {
          tab.classList.toggle("active", tab.dataset.tab === activeTab);
        });

        loadCurrentTab();
      });
    });

    document
      .getElementById("evassistant-content")
      .addEventListener("click", handleContentClick);

    document
      .getElementById("evassistant-content")
      .addEventListener("change", handleContentChange);

    loadCurrentTab();
  }

  async function refreshAccessToken() {
    if (refreshAccessTokenPromise) {
      return refreshAccessTokenPromise;
    }

    refreshAccessTokenPromise = (async () => {
      const pageToken = await requestAccessTokenFromPage();
      if (pageToken) {
        cachedAccessToken = pageToken;
        return pageToken;
      }

      const { ok, status, json } = await requestEvaApiFromActiveTab({
        operationName: "refreshToken",
        variables: {},
        query: REFRESH_TOKEN_QUERY,
        authMode: "none"
      });

      if (!ok || json?.errors?.length || !json?.data?.refreshToken?.accessToken) {
        throw new Error(
          `Impossible de rafraîchir le token (HTTP ${status}) :\n` +
          JSON.stringify(json?.errors ?? json ?? {}, null, 2)
        );
      }

      cachedAccessToken = json.data.refreshToken.accessToken;
      return cachedAccessToken;
    })();

    try {
      return await refreshAccessTokenPromise;
    } finally {
      refreshAccessTokenPromise = null;
    }
  }

  async function requestAccessTokenFromPage() {
    try {
      const tabId = await getActiveEvaTabId();
      await ensureBridgeInjected(tabId);

      return await new Promise(resolve => {
        chrome.tabs.sendMessage(tabId, { type: "evassistant-get-access-token" }, response => {
          if (chrome.runtime.lastError || !response?.accessToken) {
            resolve(null);
            return;
          }

          resolve(response.accessToken);
        });
      });
    } catch (_) {
      return null;
    }
  }

  async function graphql(operationName, variables, query) {
    if (!cachedAccessToken) {
      try {
        await refreshAccessToken();
      } catch (_) {
        throw new Error(AUTH_REQUIRED_MESSAGE);
      }
    }

    let json = await graphqlRequest(operationName, variables, query);

    const isUnauthenticated =
      json.errors?.some(e => e.extensions?.code === "UNAUTHENTICATED");

    if (isUnauthenticated) {
      cachedAccessToken = null;
      try {
        await refreshAccessToken();
      } catch (_) {
        throw new Error(AUTH_REQUIRED_MESSAGE);
      }
      json = await graphqlRequest(operationName, variables, query);
    }

    if (json.errors?.length) {
      if (isAuthError(json.errors)) {
        throw new Error(AUTH_REQUIRED_MESSAGE);
      }

      throw new Error(JSON.stringify(json.errors, null, 2));
    }

    return json.data;
  }

  async function graphqlRequest(operationName, variables, query) {
    const { ok, status, json } = await requestEvaApiFromActiveTab({
      operationName,
      variables,
      query,
      accessToken: cachedAccessToken,
      authMode: "explicit"
    });

    if (!ok) {
      throw new Error(`HTTP ${status}\n${JSON.stringify(json ?? {}, null, 2)}`);
    }

    return json;
  }

  async function graphqlPublic(operationName, variables, query) {
    const { ok, status, json } = await requestEvaApiFromActiveTab({
      operationName,
      variables,
      query,
      authMode: "none"
    });

    if (!ok) {
      throw new Error(`HTTP ${status}\n${JSON.stringify(json ?? {}, null, 2)}`);
    }

    if (json.errors?.length) {
      throw new Error(JSON.stringify(json.errors, null, 2));
    }

    return json.data;
  }

  async function graphqlTry(operationName, variables, query, { usePublic = false } = {}) {
    try {
      return usePublic
        ? await graphqlPublic(operationName, variables, query)
        : await graphql(operationName, variables, query);
    } catch (_) {
      return null;
    }
  }

  async function requestEvaApiFromActiveTab(payload) {
    const tabId = await getActiveEvaTabId();
    await ensureBridgeInjected(tabId);

    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { type: "evassistant-api-request", payload }, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(`Impossible de contacter l'onglet EVA: ${chrome.runtime.lastError.message}`));
          return;
        }

        if (!response) {
          reject(new Error("Aucune reponse de l'onglet EVA."));
          return;
        }

        if (response.error) {
          reject(new Error(response.error));
          return;
        }

        resolve(response);
      });
    });
  }

  async function getActiveEvaTabId() {
    if (activeEvaTabIdCache !== null) {
      return activeEvaTabIdCache;
    }

    const isEvaUrl = url => /^https:\/\/(app|www)\.eva\.gg\//.test(url ?? "");

    const activeTabs = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    const activeTab = activeTabs?.[0];
    if (activeTab?.id && isEvaUrl(activeTab.url)) {
      activeEvaTabIdCache = activeTab.id;
      return activeEvaTabIdCache;
    }

    const evaTabsCurrentWindow = await chrome.tabs.query({
      currentWindow: true,
      url: ["https://app.eva.gg/*", "https://www.eva.gg/*"]
    });
    if (evaTabsCurrentWindow?.[0]?.id) {
      activeEvaTabIdCache = evaTabsCurrentWindow[0].id;
      return activeEvaTabIdCache;
    }

    const evaTabsAllWindows = await chrome.tabs.query({
      url: ["https://app.eva.gg/*", "https://www.eva.gg/*"]
    });
    if (evaTabsAllWindows?.[0]?.id) {
      activeEvaTabIdCache = evaTabsAllWindows[0].id;
      return activeEvaTabIdCache;
    }

    throw new Error("Ouvre un onglet EVA connecté (app.eva.gg ou www.eva.gg), puis réessaie.");
  }

  function waitForTabComplete(tabId, timeoutMs = 15000) {
    return new Promise(resolve => {
      chrome.tabs.get(tabId, tab => {
        if (!tab || tab.status === "complete") {
          resolve();
          return;
        }

        const timeout = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }, timeoutMs);

        const listener = (updatedTabId, info) => {
          if (updatedTabId === tabId && info.status === "complete") {
            clearTimeout(timeout);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };

        chrome.tabs.onUpdated.addListener(listener);
      });
    });
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function waitForBridgeReady(tabId, maxAttempts = 40) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const ready = await new Promise(resolve => {
        chrome.tabs.sendMessage(tabId, { type: "evassistant-get-access-token" }, response => {
          resolve(!chrome.runtime.lastError && response !== undefined);
        });
      });

      if (ready) {
        return true;
      }

      await delay(300);
    }

    return false;
  }

  async function scrollToSessionOnEvaTab(tabId, hints) {
    await ensureBridgeInjected(tabId);
    await waitForBridgeReady(tabId);

    return new Promise(resolve => {
      chrome.tabs.sendMessage(tabId, {
        type: "evassistant-scroll-to-session",
        payload: { hints }
      }, response => {
        if (chrome.runtime.lastError) {
          resolve(false);
          return;
        }

        resolve(Boolean(response?.scrolled));
      });
    });
  }

  async function openBookingSessionOnEva(actionElement) {
    const url = actionElement.dataset.sessionUrl;
    if (!url) {
      return;
    }

    const hints = {
      startTime: actionElement.dataset.startTime ?? "",
      convocationTime: actionElement.dataset.convocationTime ?? "",
      localDatetime: actionElement.dataset.localDatetime ?? "",
      gameName: actionElement.dataset.gameName ?? "",
      date: actionElement.dataset.sessionDate ?? "",
      locationId: actionElement.dataset.locationId ?? ""
    };

    let tabId;

    try {
      const evaTabs = await chrome.tabs.query({
        url: ["https://app.eva.gg/*", "https://www.eva.gg/*"]
      });

      if (evaTabs[0]?.id) {
        tabId = evaTabs[0].id;

        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: pendingHints => {
              sessionStorage.setItem("evassistant-pending-scroll", JSON.stringify(pendingHints));
            },
            args: [hints]
          });
        } catch (_) {
          // Ignore if the tab is not ready yet.
        }

        await chrome.tabs.update(tabId, { url, active: true });
      } else {
        const tab = await chrome.tabs.create({ url, active: true });
        tabId = tab.id;
      }

      await waitForTabComplete(tabId, 20000);
      await waitForBridgeReady(tabId);
      await scrollToSessionOnEvaTab(tabId, hints);
    } catch (_) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  async function ensureBridgeInjected(tabId) {
    // Le content script injecte déjà page-api-main.js et page-bridge.js sur app.eva.gg.
    // On garde ce fallback pour les onglets ouverts avant l'installation/rechargement.
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["page-api-main.js"],
        world: "MAIN"
      });
    } catch (_) {
      // Ignore si déjà injecté.
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["page-bridge.js"]
      });
    } catch (_) {
      // Ignore si déjà injecté.
    }
  }

  function loadCurrentTab() {
    if (activeTab === "favorites") {
      return renderFavoritesTab();
    }

    if (activeTab === "history") {
      return loadGameHistory();
    }

    return loadUpcomingParticipants();
  }

  function buildBookingCalendarUrl(config) {
    const locale = config.locale ?? "fr-FR";
    const params = new URLSearchParams({
      locationId: String(config.locationId),
      gameIds: String(config.gameIds),
      seatCount: String(config.seatCount)
    });

    return `${EVA_APP_ORIGIN}/${locale}/booking/calendar?${params.toString()}`;
  }

  async function readFavorites() {
    try {
      const rawValue = localStorage.getItem(FAVORITES_STORAGE_KEY)
        ?? localStorage.getItem(LEGACY_FAVORITES_STORAGE_KEY);
      if (!rawValue) return [];

      const favorites = normalizeFavorites(JSON.parse(rawValue));
      if (!localStorage.getItem(FAVORITES_STORAGE_KEY) && favorites.length) {
        localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
      }

      return favorites;
    } catch (_) {
      return [];
    }
  }

  async function writeFavorites(favorites) {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  }

  function normalizeFavorites(value) {
    if (!Array.isArray(value)) return [];

    return value.filter(entry =>
      entry
      && entry.id
      && entry.locationId
      && entry.gameIds
      && entry.seatCount
    );
  }

  async function renderFavoritesTab(message = "") {
    const content = document.getElementById("evassistant-content");
    content.innerHTML = "Chargement des paramètres de favoris...";

    const [rawFavorites, locations] = await Promise.all([
      readFavorites(),
      loadLocations()
    ]);
    const favorites = await enrichFavoritesWithNames(rawFavorites, locations);

    const selectedLocationId = pickLocationId(locations, favoriteBuilderState.locationId);
    favoriteBuilderState.locationId = selectedLocationId;

    const games = selectedLocationId
      ? await loadGamesForLocation(selectedLocationId)
      : [];

    const selectedGameId = pickGameId(games, favoriteBuilderState.gameId);
    favoriteBuilderState.gameId = selectedGameId;

    const selectedGame = games.find(entry => String(entry.game.id) === String(selectedGameId)) ?? null;
    const seatChoices = buildSeatChoices(selectedGame);
    const selectedSeatCount = pickSeatCount(seatChoices, favoriteBuilderState.seatCount);
    favoriteBuilderState.seatCount = selectedSeatCount;

    if (!favorites.length) {
      content.innerHTML = `
        ${message ? `<p class="evassistant-feedback">${escapeHtml(message)}</p>` : ""}
        <p>Aucun favori enregistré pour le moment.</p>
        ${renderFavoriteBuilder(locations, games, seatChoices)}
      `;
      return;
    }

    content.innerHTML = `
      ${message ? `<p class="evassistant-feedback">${escapeHtml(message)}</p>` : ""}
      <div class="evassistant-favorites-grid">
        ${favorites.map(favorite => `
        <section class="evassistant-session evassistant-favorite-card" data-action="open-favorite" data-favorite-id="${escapeHtml(favorite.id)}" role="button" tabindex="0" title="Ouvrir ce favori">
          <button class="evassistant-favorite-delete" data-action="delete-favorite" data-favorite-id="${escapeHtml(favorite.id)}" title="Supprimer ce favori" aria-label="Supprimer ce favori">×</button>
          <h3>${escapeHtml(favorite.label ?? "Favori")}</h3>
          <div class="evassistant-favorite-inline-meta">
            <span><strong>Centre:</strong> ${escapeHtml(favorite.locationName ?? favorite.locationId)}</span>
            <span><strong>Jeu:</strong> ${escapeHtml(favorite.gameName ?? favorite.gameIds)}</span>
            <span><strong>Joueurs:</strong> ${escapeHtml(favorite.seatCount)}</span>
          </div>
        </section>
      `).join("")}
      </div>
      ${renderFavoriteBuilder(locations, games, seatChoices)}
    `;
  }

  function renderFavoriteBuilder(locations, games, seatChoices) {
    const locationOptions = locations.map(location => `
      <option value="${escapeHtml(location.id)}" ${String(location.id) === String(favoriteBuilderState.locationId) ? "selected" : ""}>
        ${escapeHtml(location.name)} (${escapeHtml(location.department ?? "-")})
      </option>
    `).join("");

    const gameOptions = games.map(entry => `
      <option value="${escapeHtml(entry.game.id)}" ${String(entry.game.id) === String(favoriteBuilderState.gameId) ? "selected" : ""}>
        ${escapeHtml(entry.game.name)}
      </option>
    `).join("");

    const seatOptions = seatChoices.map(value => `
      <option value="${escapeHtml(value)}" ${String(value) === String(favoriteBuilderState.seatCount) ? "selected" : ""}>
        ${escapeHtml(value)}
      </option>
    `).join("");

    return `
      <details class="evassistant-session evassistant-favorite-builder">
        <summary>Créer un favori</summary>
        <div class="evassistant-form-grid">
          <label>
            Salle
            <select data-favorite-field="locationId">
              ${locationOptions || '<option value="">Aucune salle</option>'}
            </select>
          </label>
          <label>
            Jeu
            <select data-favorite-field="gameId">
              ${gameOptions || '<option value="">Aucun jeu</option>'}
            </select>
          </label>
          <label>
            Joueurs
            <select data-favorite-field="seatCount">
              ${seatOptions || '<option value="">-</option>'}
            </select>
          </label>
          <label>
            Nom du favori
            <input
              type="text"
              data-favorite-field="label"
              placeholder="Ex: Aix Battle 1 joueur"
              value="${escapeHtml(favoriteBuilderState.label)}"
            />
          </label>
        </div>
        <div class="evassistant-favorite-actions">
          <button data-action="create-favorite-from-builder">Enregistrer</button>
        </div>
      </details>
    `;
  }

  async function handleContentClick(event) {
    const actionElement = event.target.closest("[data-action]");
    if (!actionElement) return;

    const action = actionElement.dataset.action;
    const favoriteId = actionElement.dataset.favoriteId;

    if (action === "create-favorite-from-builder") {
      await saveFavoriteFromBuilder();
      return;
    }

    if (action === "open-session") {
      event.preventDefault();
      await openBookingSessionOnEva(actionElement);
      return;
    }

    if (!favoriteId) return;

    if (action === "open-favorite") {
      await openFavoriteById(favoriteId);
      return;
    }

    if (action === "delete-favorite") {
      await deleteFavoriteById(favoriteId);
    }
  }

  async function handleContentChange(event) {
    const field = event.target?.dataset?.favoriteField;
    if (!field) return;

    if (field === "locationId") {
      favoriteBuilderState.locationId = event.target.value;
      favoriteBuilderState.gameId = "";
      favoriteBuilderState.seatCount = "";
      await refreshFavoriteBuilderFields();
      return;
    }

    if (field === "gameId") {
      favoriteBuilderState.gameId = event.target.value;
      favoriteBuilderState.seatCount = "";
      await refreshFavoriteBuilderFields();
      return;
    }

    if (field === "seatCount") {
      favoriteBuilderState.seatCount = event.target.value;
      return;
    }

    if (field === "label") {
      favoriteBuilderState.label = event.target.value;
    }
  }

  async function refreshFavoriteBuilderFields() {
    const content = document.getElementById("evassistant-content");
    if (!content) return;

    const locationSelect = content.querySelector('select[data-favorite-field="locationId"]');
    const gameSelect = content.querySelector('select[data-favorite-field="gameId"]');
    const seatSelect = content.querySelector('select[data-favorite-field="seatCount"]');
    if (!locationSelect || !gameSelect || !seatSelect) return;

    const selectedLocationId = String(locationSelect.value || favoriteBuilderState.locationId || "");
    favoriteBuilderState.locationId = selectedLocationId;

    const games = selectedLocationId ? await loadGamesForLocation(selectedLocationId) : [];
    const selectedGameId = pickGameId(games, favoriteBuilderState.gameId);
    favoriteBuilderState.gameId = selectedGameId;
    replaceSelectOptions(
      gameSelect,
      games.map(entry => ({
        value: String(entry.game.id),
        label: entry.game.name
      })),
      selectedGameId,
      "Aucun jeu"
    );

    const selectedGame = games.find(entry => String(entry.game.id) === String(selectedGameId)) ?? null;
    const seatChoices = buildSeatChoices(selectedGame);
    const selectedSeatCount = pickSeatCount(seatChoices, favoriteBuilderState.seatCount);
    favoriteBuilderState.seatCount = selectedSeatCount;
    replaceSelectOptions(
      seatSelect,
      seatChoices.map(value => ({
        value: String(value),
        label: String(value)
      })),
      selectedSeatCount,
      "-"
    );
  }

  function replaceSelectOptions(selectElement, options, selectedValue, emptyLabel) {
    selectElement.innerHTML = options.length
      ? options.map(option => `
          <option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>
        `).join("")
      : `<option value="">${escapeHtml(emptyLabel)}</option>`;

    selectElement.value = options.length ? String(selectedValue ?? options[0].value) : "";
  }

  async function loadLocations() {
    if (locationsCache) {
      return locationsCache;
    }

    const data = await graphqlPublic(
      "listLocations",
      {
        country: "FR",
        sortOrder: {
          by: "DEPARTMENT"
        }
      },
      LIST_LOCATIONS_QUERY
    );

    locationsCache = (data?.listLocations ?? [])
      .filter(location => location?.id && location?.name)
      .filter(location => location.status !== "Closed");

    return locationsCache;
  }

  async function loadGamesForLocation(locationId) {
    const key = String(locationId);
    if (locationGamesCache.has(key)) {
      return locationGamesCache.get(key);
    }

    const data = await graphqlPublic(
      "Booking",
      {
        id: Number(locationId)
      },
      BOOKING_LOCATION_QUERY
    );

    const games = (data?.location?.locationGames ?? [])
      .filter(entry => entry?.game?.id && entry?.game?.name);

    locationGamesCache.set(key, games);
    return games;
  }

  function pickLocationId(locations, currentLocationId) {
    if (!locations.length) return "";
    if (currentLocationId && locations.some(location => String(location.id) === String(currentLocationId))) {
      return String(currentLocationId);
    }
    return String(locations[0].id);
  }

  function pickGameId(games, currentGameId) {
    if (!games.length) return "";
    if (currentGameId && games.some(entry => String(entry.game.id) === String(currentGameId))) {
      return String(currentGameId);
    }
    return String(games[0].game.id);
  }

  function buildSeatChoices(selectedGameEntry) {
    if (!selectedGameEntry) return [];

    return Array.from({ length: 10 }, (_, index) => String(index + 1));
  }

  function pickSeatCount(seatChoices, currentSeatCount) {
    if (!seatChoices.length) return "";
    if (currentSeatCount && seatChoices.includes(String(currentSeatCount))) {
      return String(currentSeatCount);
    }
    return String(seatChoices[0]);
  }

  async function saveFavoriteFromBuilder() {
    const locations = await loadLocations();
    const locationId = pickLocationId(locations, favoriteBuilderState.locationId);
    if (!locationId) return;

    const games = await loadGamesForLocation(locationId);
    const gameId = pickGameId(games, favoriteBuilderState.gameId);
    if (!gameId) return;

    const selectedGame = games.find(entry => String(entry.game.id) === String(gameId)) ?? null;
    const seatChoices = buildSeatChoices(selectedGame);
    const seatCount = pickSeatCount(seatChoices, favoriteBuilderState.seatCount);
    if (!seatCount) return;

    const location = locations.find(entry => String(entry.id) === String(locationId));
    const game = selectedGame?.game;
    if (!location || !game) return;

    const customLabel = favoriteBuilderState.label.trim();
    const label = customLabel || `${location.name} • ${game.name} • ${seatCount} joueur(s)`;

    const favoriteToSave = {
      id: `${locationId}-${gameId}-${seatCount}`,
      label,
      locationId: String(locationId),
      locationName: String(location.name),
      gameIds: String(gameId),
      gameName: String(game.name),
      seatCount: String(seatCount),
      locale: "fr-FR",
      savedAt: Date.now()
    };

    const favorites = await readFavorites();
    const existingIndex = favorites.findIndex(entry => entry.id === favoriteToSave.id);

    if (existingIndex >= 0) {
      favorites[existingIndex] = favoriteToSave;
    } else {
      favorites.unshift(favoriteToSave);
    }

    await writeFavorites(favorites.slice(0, 20));
    favoriteBuilderState.label = "";
    await renderFavoritesTab("Favori enregistré.");
  }

  async function enrichFavoritesWithNames(favorites, locations) {
    if (!favorites.length) return favorites;

    const locationNameById = new Map(
      locations.map(location => [String(location.id), location.name])
    );

    const favoritesWithNames = [];
    for (const favorite of favorites) {
      const locationId = String(favorite.locationId);
      const locationName = favorite.locationName || locationNameById.get(locationId) || favorite.locationId;

      let gameName = favorite.gameName;
      if (!gameName) {
        try {
          const games = await loadGamesForLocation(locationId);
          const game = games.find(entry => String(entry.game.id) === String(favorite.gameIds));
          gameName = game?.game?.name || favorite.gameIds;
        } catch (_) {
          gameName = favorite.gameIds;
        }
      }

      favoritesWithNames.push({
        ...favorite,
        locationName,
        gameName
      });
    }

    return favoritesWithNames;
  }

  async function openFavoriteById(favoriteId) {
    const favorite = (await readFavorites()).find(entry => entry.id === favoriteId);
    if (!favorite) return;

    await openUrlInCurrentEvaTab(buildBookingCalendarUrl(favorite));
  }

  async function openUrlInCurrentEvaTab(url) {
    try {
      const tabId = await getActiveEvaTabId();
      await chrome.tabs.update(tabId, { url, active: true });
      return;
    } catch (_) {
      const evaTabs = await chrome.tabs.query({
        url: ["https://app.eva.gg/*", "https://www.eva.gg/*"]
      });

      if (evaTabs[0]?.id) {
        await chrome.tabs.update(evaTabs[0].id, { url, active: true });
      }
    }
  }

  async function deleteFavoriteById(favoriteId) {
    const favorites = await readFavorites();
    const filteredFavorites = favorites.filter(entry => entry.id !== favoriteId);
    await writeFavorites(filteredFavorites);
    await renderFavoritesTab("Favori supprimé.");
  }

  async function loadUpcomingParticipants() {
    const content = document.getElementById("evassistant-content");
    content.innerHTML = "Chargement des réservations à venir...";
    activeEvaTabIdCache = null;
    cachedAccessToken = null;

    try {
      const bookingData = await graphql(
        "getBookingOrderList",
        {
          page: {
            page: 1,
            limit: 50
          },
          filters: {
            bookingPassed: false
          }
        },
        BOOKING_QUERY
      );

      const bookings = extractBookings(bookingData)
        .sort((a, b) => getBookingTime(a) - getBookingTime(b));

      if (!bookings.length) {
        content.innerHTML = "Aucune session à venir trouvée.";
        return;
      }

      content.innerHTML = `Chargement des sessions pour ${bookings.length} réservation(s)...`;

      const sessionsByLookupKey = await loadGameSessionsForBookings(bookings);
      const sessions = bookings.map(booking => {
        const lookupKey = getSessionLookupKey(booking);
        const gameSessions = lookupKey ? sessionsByLookupKey.get(lookupKey) ?? [] : [];
        const gameSession = findGameSessionForBooking(gameSessions, booking);
        return { booking, gameSession };
      });

      renderUpcomingSessions(sessions);
    } catch (error) {
      renderError(error);
    }
  }

  function getBookingDate(booking) {
    const value = booking?.slot?.localDatetime;
    if (!value) return "";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value).slice(0, 10);
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function getSessionLookupKey(booking) {
    const locationId = booking.location?.id;
    const date = getBookingDate(booking);

    if (!locationId || !date) {
      return "";
    }

    return `${locationId}:${date}`;
  }

  function groupBookingsForSessionLookup(bookings) {
    const groups = new Map();

    for (const booking of bookings) {
      const lookupKey = getSessionLookupKey(booking);
      if (!lookupKey) continue;

      if (!groups.has(lookupKey)) {
        const [locationId, date] = lookupKey.split(":");
        groups.set(lookupKey, {
          locationId: Number(locationId),
          date,
          seatCount: booking.seatCount || 1
        });
      } else {
        const group = groups.get(lookupKey);
        group.seatCount = Math.max(group.seatCount, booking.seatCount || 1);
      }
    }

    return [...groups.values()];
  }

  async function loadGameSessionsForBookings(bookings) {
    const sessionsByLookupKey = new Map();
    const groups = groupBookingsForSessionLookup(bookings);

    await Promise.all(groups.map(async group => {
      const lookupKey = `${group.locationId}:${group.date}`;
      const variables = {
        data: {
          date: group.date,
          isCompetitiveModeOnly: false,
          locationId: group.locationId,
          seatCount: group.seatCount,
          seatTypes: ["PLAYER"]
        }
      };

      let data = await graphqlTry("useSessions", variables, USE_SESSIONS_QUERY, { usePublic: true });
      if (!data?.listLocationGameSessionsByDate) {
        data = await graphqlTry("useSessions", variables, USE_SESSIONS_QUERY);
      }

      sessionsByLookupKey.set(
        lookupKey,
        data?.listLocationGameSessionsByDate ?? []
      );
    }));

    return sessionsByLookupKey;
  }

  function findGameSessionForBooking(gameSessions, booking) {
    if (!gameSessions?.length) {
      return null;
    }

    const gameId = booking.gameId ?? booking.game?.id;

    return gameSessions.find(session =>
      session.terrain?.id === booking.terrainId &&
      String(session.game?.id) === String(gameId) &&
      (
        session.slot?.id === booking.slot?.id ||
        session.slot?.startTime === booking.slot?.startTime ||
        session.slot?.localDatetime === booking.slot?.localDatetime
      )
    ) ?? gameSessions.find(session =>
      session.terrain?.id === booking.terrainId &&
      String(session.game?.id) === String(gameId) &&
      session.slot?.startTime === booking.slot?.startTime
    ) ?? null;
  }

  async function loadGameHistory() {
    const content = document.getElementById("evassistant-content");
    content.innerHTML = "Chargement de l'historique des parties...";

    try {
      const { userId, seasonId } = await getGameHistoryContext();
      const data = await graphql(
        "useAfterhGameHistoryPageLastOnly",
        { userId, seasonId },
        GAME_HISTORY_QUERY
      );

      const games = (data?.listLastAfterhGameHistoriesByUserAndSeason ?? [])
        .sort((a, b) => getGameHistoryTime(b) - getGameHistoryTime(a));

      if (!games.length) {
        content.innerHTML = "Aucune partie dans l'historique.";
        return;
      }

      renderGameHistorySessions(games, userId);
    } catch (error) {
      renderError(error);
    }
  }

  async function getGameHistoryContext() {
    if (!cachedAccessToken) {
      await refreshAccessToken();
    }

    let userId = getUserIdFromAccessToken(cachedAccessToken);
    if (!userId) {
      const meData = await graphql("me", {}, GET_ME_QUERY);
      userId = Number(meData?.me?.id);
    }

    if (!userId || Number.isNaN(userId)) {
      throw new Error("Impossible de récupérer ton identifiant EVA.");
    }

    const seasonId = await fetchCurrentSeasonId();
    return { userId, seasonId };
  }

  function getUserIdFromAccessToken(token) {
    if (!token) return null;

    try {
      const payloadPart = token.split(".")[1];
      if (!payloadPart) return null;

      const payload = JSON.parse(atob(payloadPart.replace(/-/g, "+").replace(/_/g, "/")));
      const value = payload.userId ?? payload.sub ?? payload.id;
      if (value == null) return null;

      const userId = Number(value);
      return Number.isNaN(userId) ? null : userId;
    } catch (_) {
      return null;
    }
  }

  async function fetchCurrentSeasonId() {
    try {
      const data = await graphql(
        "listAfterhSeasons",
        {},
        LIST_AFTERH_SEASONS_QUERY
      );

      const seasons = data?.listAfterhSeasons ?? [];
      const currentSeason = seasons.find(season => season.isCurrent);
      if (currentSeason?.id != null) {
        return Number(currentSeason.id);
      }

      if (seasons.length) {
        return Math.max(...seasons.map(season => Number(season.id)));
      }
    } catch (_) {
      // Fallback sur la saison courante connue.
    }

    return 8;
  }

  function renderGameHistorySessions(games, currentUserId) {
    const content = document.getElementById("evassistant-content");

    content.innerHTML = games.map(game => {
      const outcomeClass = getGameOutcomeClass(game, currentUserId);
      return `
      <section class="evassistant-session evassistant-game-card ${outcomeClass}">
        ${renderGameHistoryHeader(game, currentUserId)}
        ${renderGamePlayersTable(game.players ?? [], currentUserId)}
      </section>
    `;
    }).join("");
  }

  function getGameOutcomeClass(game, currentUserId) {
    const currentPlayer = (game.players ?? []).find(player => Number(player.userId) === Number(currentUserId));
    const outcome = currentPlayer?.data?.outcome;

    if (outcome === "Victory") return "evassistant-game-won";
    if (outcome === "Defeat") return "evassistant-game-lost";
    return "";
  }

  function renderGameHistoryHeader(game, currentUserId) {
    const mapName = game.map?.name ?? "Carte inconnue";
    const modeName = game.mode?.identifier ?? "-";
    const locationName = game.terrain?.location?.name ?? "Lieu inconnu";
    const terrainName = game.terrain?.name ?? "-";
    const date = formatGameDate(game.createdAt);
    const duration = formatDuration(game.data?.duration);
    const currentPlayer = (game.players ?? []).find(player => Number(player.userId) === Number(currentUserId));
    const outcome = formatOutcome(currentPlayer?.data?.outcome);
    const teamOne = game.data?.teamOne;
    const teamTwo = game.data?.teamTwo;
    const scoreLine = teamOne && teamTwo
      ? `${escapeHtml(teamOne.name)} ${escapeHtml(teamOne.score)} - ${escapeHtml(teamTwo.score)} ${escapeHtml(teamTwo.name)}`
      : null;

    return `
      <h3>${escapeHtml(mapName)} · ${escapeHtml(modeName)}</h3>

      <div class="evassistant-game-meta-compact">
        <div class="evassistant-game-meta-item">
          <span>Lieu</span>
          <span>${escapeHtml(locationName)}</span>
        </div>
        <div class="evassistant-game-meta-item">
          <span>Terrain</span>
          <span>${escapeHtml(terrainName)}</span>
        </div>
        <div class="evassistant-game-meta-item">
          <span>Date</span>
          <span>${escapeHtml(date)}</span>
        </div>
        <div class="evassistant-game-meta-item">
          <span>Durée</span>
          <span>${escapeHtml(duration)}</span>
        </div>
        ${scoreLine ? `
        <div class="evassistant-game-meta-item evassistant-game-meta-item-full">
          <span>Score</span>
          <span>${scoreLine}</span>
        </div>` : ""}
        <div class="evassistant-game-meta-item">
          <span>Résultat</span>
          <span>${escapeHtml(outcome)}</span>
        </div>
        <div class="evassistant-game-meta-item">
          <span>Joueurs</span>
          <span>${escapeHtml((game.players ?? []).length)}</span>
        </div>
      </div>
    `;
  }

  function renderGamePlayersTable(players, currentUserId) {
    if (!players.length) {
      return `<p>Aucun joueur trouvé.</p>`;
    }

    const sortedPlayers = [...players].sort((a, b) => {
      const scoreDiff = Number(b.data?.score ?? 0) - Number(a.data?.score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;

      const killsDiff = Number(b.data?.kills ?? 0) - Number(a.data?.kills ?? 0);
      if (killsDiff !== 0) return killsDiff;

      return Number(a.data?.deaths ?? 0) - Number(b.data?.deaths ?? 0);
    });
    const currentPlayer = sortedPlayers.find(player => Number(player.userId) === Number(currentUserId));
    const currentTeam = currentPlayer?.data?.team ?? null;

    return `
      <table class="evassistant-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Pseudo</th>
            <th>Équipe</th>
            <th>Score</th>
            <th>Résultat</th>
            <th>K / D / A</th>
          </tr>
        </thead>
        <tbody>
          ${sortedPlayers.map((player, index) => {
            const isCurrentUser = Number(player.userId) === Number(currentUserId);
            const rowClass = getGamePlayerRowClass(player, currentTeam, isCurrentUser);
            return `
            <tr class="${rowClass}">
              <td>${index + 1}</td>
              <td>${escapeHtml(player.data?.niceName ?? "-")}</td>
              <td>${escapeHtml(player.data?.team ?? "-")}</td>
              <td>${escapeHtml(player.data?.score ?? "-")}</td>
              <td>${escapeHtml(formatOutcome(player.data?.outcome))}</td>
              <td>${escapeHtml(player.data?.kills ?? "-")} / ${escapeHtml(player.data?.deaths ?? "-")} / ${escapeHtml(player.data?.assists ?? "-")}</td>
            </tr>
          `;
          }).join("")}
        </tbody>
      </table>
    `;
  }

  function getGamePlayerRowClass(player, currentTeam, isCurrentUser) {
    const playerTeam = normalizeTeam(player?.data?.team);
    const myTeam = normalizeTeam(currentTeam);
    let baseClass = "";

    if (myTeam && playerTeam) {
      baseClass = playerTeam === myTeam
        ? "evassistant-team-own"
        : "evassistant-team-enemy";
    }

    return isCurrentUser
      ? `${baseClass} evassistant-current-player`.trim()
      : baseClass;
  }

  function normalizeTeam(value) {
    if (!value) return "";
    return String(value).trim().toUpperCase();
  }

  function getGameHistoryTime(game) {
    const time = new Date(game?.createdAt ?? 0).getTime();
    return Number.isNaN(time) ? 0 : time;
  }

  function formatDuration(seconds) {
    if (!seconds && seconds !== 0) return "-";

    const totalSeconds = Number(seconds);
    if (Number.isNaN(totalSeconds)) return "-";

    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;
    return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  function formatOutcome(outcome) {
    if (!outcome) return "-";
    if (outcome === "Victory") return "Victoire";
    if (outcome === "Defeat") return "Défaite";
    return outcome;
  }

  function renderUpcomingSessions(sessions) {
    const content = document.getElementById("evassistant-content");

    content.innerHTML = `
      <div class="evassistant-upcoming-grid">
        ${sessions.map(({ booking, gameSession }) => renderUpcomingCard(booking, gameSession)).join("")}
      </div>
    `;
  }

  function renderUpcomingCard(booking, gameSession) {
    const gameName = booking.game?.name ?? gameSession?.game?.name ?? "Session EVA";
    const locationName = booking.location?.name ?? "Lieu inconnu";
    const date = formatDate(booking.slot.localDatetime);
    const time = booking.slot.startTime ?? "-";
    const playerCount = gameSession?.takenSeatCount ?? "—";

    return `
      <article class="evassistant-upcoming-card">
        <div class="evassistant-upcoming-card__head">
          <h3>${escapeHtml(gameName)}</h3>
          ${booking.sessionLink
            ? `<a
                class="evassistant-session-link"
                href="#"
                data-action="open-session"
                data-session-url="${escapeHtml(booking.sessionLink)}"
                data-start-time="${escapeHtml(gameSession?.slot?.startTime ?? booking.slot?.startTime ?? "")}"
                data-convocation-time="${escapeHtml(gameSession?.slot?.convocationTime ?? booking.slot?.convocationTime ?? "")}"
                data-local-datetime="${escapeHtml(booking.slot?.localDatetime ?? gameSession?.slot?.localDatetime ?? "")}"
                data-game-name="${escapeHtml(booking.game?.name ?? gameSession?.game?.name ?? "")}"
                data-session-date="${escapeHtml(getBookingDate(booking))}"
                data-location-id="${escapeHtml(String(booking.location?.id ?? ""))}"
              >Voir la session</a>`
            : ""}
        </div>
        <div class="evassistant-upcoming-meta evassistant-upcoming-meta--compact">
          <div><span>Lieu</span><span>${escapeHtml(locationName)}</span></div>
          <div><span>Date</span><span>${escapeHtml(date)}</span></div>
          <div><span>Horaire</span><span>${escapeHtml(time)}</span></div>
          <div><span>Joueurs</span><span>${escapeHtml(String(playerCount))}</span></div>
        </div>
      </article>
    `;
  }

  function extractBookings(data) {
    const orders = data?.listBookingOrders?.nodes ?? [];

    return orders
      .flatMap(order =>
        (order.items ?? []).map(item => ({
          ...item.booking,
          orderId: item.booking?.orderId ?? order.id
        }))
      )
      .filter(Boolean)
      .filter(booking => booking.slot?.id && booking.terrainId && booking.orderId);
  }

  function getBookingTime(booking) {
    const value = booking?.slot?.localDatetime;
    const time = new Date(value ?? 0).getTime();

    return Number.isNaN(time) ? 0 : time;
  }

  function formatGameDate(value) {
    if (!value) return "-";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function formatDate(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "full",
      timeStyle: "short"
    }).format(date);
  }

  function renderError(error) {
    const content = document.getElementById("evassistant-content");

    if (isAuthError(error?.message)) {
      content.innerHTML = `<p class="evassistant-auth-required">${escapeHtml(AUTH_REQUIRED_MESSAGE)}</p>`;
      return;
    }

    content.innerHTML = `<pre class="evassistant-error">${escapeHtml(error.message)}</pre>`;
  }

  function isAuthError(value) {
    if (Array.isArray(value)) {
      return value.some(entry => isAuthError(entry));
    }

    if (!value) return false;

    const text = typeof value === "string"
      ? value
      : JSON.stringify(value);

    return /UNAUTHENTICATED|Forbidder error|AUTH_REQUIRED_MESSAGE|401/i.test(text);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  init();
})();