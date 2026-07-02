(function () {
  const API_URL = "https://api.eva.gg/graphql";
  const PANEL_ID = "eva-participants-panel";
  const AUTH_REQUIRED_MESSAGE = "Connecte-toi à ton compte EVA pour utiliser l'extension.";
  const FAVORITES_STORAGE_KEY = "eva_ext_booking_favorites_v1";

  let cachedAccessToken = null;
  let refreshAccessTokenPromise = null;
  let activeTab = "upcoming";
  let isPanelCollapsed = false;
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
              playerCount
              seatCount
              status
              orderId
              bookingGroupUnitId
              slot {
                id
                localDatetime
                startTime
                endTime
              }
              game {
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

  const UPCOMING_PARTICIPANTS_QUERY = `
    query listParticipants($slotId: String!, $terrainId: Int!) {
      listParticipants(slotId: $slotId, terrainId: $terrainId) {
        user {
          displayName
        }
        experience {
          level
        }
        subscriptionPlan
        isAnonymous
      }
    }
  `;

  const BOOKING_GROUP_UNIT_QUERY = `
    query getBookingGroupUnitById($id: ID!) {
      getBookingGroupUnitById(id: $id) {
        id
        seatCount
        filledSeatCount
        leftSeatCount
        participants {
          id
          userId
          paidSeatCount
          level
          username {
            username
            displayName
            fullName
          }
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
      <div class="eva-ext-header">
        <strong id="eva-ext-title">Participants EVA</strong>
        <div class="eva-ext-header-actions">
          <button id="eva-ext-refresh">Rafraîchir</button>
          <button id="eva-ext-toggle" title="Réduire le panneau" aria-label="Réduire le panneau">—</button>
        </div>
      </div>

      <div class="eva-ext-tabs">
        <button class="eva-ext-tab active" data-tab="upcoming">À venir</button>
        <button class="eva-ext-tab" data-tab="history">Historique</button>
        <button class="eva-ext-tab" data-tab="favorites">Favoris</button>
      </div>

      <div id="eva-ext-content">Clique sur rafraîchir.</div>
    `;

    document.body.appendChild(panel);

    document
      .getElementById("eva-ext-refresh")
      .addEventListener("click", loadCurrentTab);

    document
      .getElementById("eva-ext-toggle")
      .addEventListener("click", () => {
        setPanelCollapsed(!isPanelCollapsed);
      });

    document.querySelectorAll(".eva-ext-tab").forEach(button => {
      button.addEventListener("click", () => {
        activeTab = button.dataset.tab;

        document.querySelectorAll(".eva-ext-tab").forEach(tab => {
          tab.classList.toggle("active", tab.dataset.tab === activeTab);
        });

        loadCurrentTab();
      });
    });

    document
      .getElementById("eva-ext-content")
      .addEventListener("click", handleContentClick);

    document
      .getElementById("eva-ext-content")
      .addEventListener("change", handleContentChange);

    setPanelCollapsed(false);
  }

  function setPanelCollapsed(collapsed) {
    isPanelCollapsed = collapsed;
    const panel = document.getElementById(PANEL_ID);
    const toggleButton = document.getElementById("eva-ext-toggle");

    if (!panel || !toggleButton) return;

    panel.classList.toggle("collapsed", isPanelCollapsed);
    toggleButton.textContent = isPanelCollapsed ? "☰" : "—";
    toggleButton.title = isPanelCollapsed ? "Ouvrir le panneau" : "Réduire le panneau";
    toggleButton.setAttribute("aria-label", toggleButton.title);
  }

  async function refreshAccessToken() {
    if (refreshAccessTokenPromise) {
      return refreshAccessTokenPromise;
    }

    refreshAccessTokenPromise = (async () => {
      const response = await fetch(API_URL, {
        method: "POST",
        credentials: "include",
        headers: {
          "accept": "*/*",
          "content-type": "application/json",
          "eva-client-app-name": "spa-app"
        },
        body: JSON.stringify({
          operationName: "refreshToken",
          variables: {},
          query: REFRESH_TOKEN_QUERY
        })
      });

      const json = await response.json();

      if (!response.ok || json.errors?.length || !json.data?.refreshToken?.accessToken) {
        throw new Error(
          "Impossible de rafraîchir le token :\n" +
          JSON.stringify(json.errors ?? json, null, 2)
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
    const response = await fetch(API_URL, {
      method: "POST",
      credentials: "include",
      headers: {
        "accept": "*/*",
        "content-type": "application/json",
        "eva-client-app-name": "spa-app",
        "authorization": `Bearer ${cachedAccessToken}`
      },
      body: JSON.stringify({
        operationName,
        variables,
        query
      })
    });

    const json = await response.json();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}\n${JSON.stringify(json, null, 2)}`);
    }

    return json;
  }

  async function graphqlPublic(operationName, variables, query) {
    const response = await fetch(API_URL, {
      method: "POST",
      credentials: "include",
      headers: {
        "accept": "*/*",
        "content-type": "application/json",
        "eva-client-app-name": "spa-app"
      },
      body: JSON.stringify({
        operationName,
        variables,
        query
      })
    });

    const json = await response.json();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}\n${JSON.stringify(json, null, 2)}`);
    }

    if (json.errors?.length) {
      throw new Error(JSON.stringify(json.errors, null, 2));
    }

    return json.data;
  }

  function loadCurrentTab() {
    if (activeTab === "favorites") {
      return renderFavoritesTab();
    }

    if (activeTab === "history") {
      return loadHistoryParticipants();
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

    return `${location.origin}/${locale}/booking/calendar?${params.toString()}`;
  }

  async function readFavorites() {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      try {
        const result = await chrome.storage.local.get(FAVORITES_STORAGE_KEY);
        const storedFavorites = result?.[FAVORITES_STORAGE_KEY];
        return normalizeFavorites(storedFavorites);
      } catch (_) {
        return [];
      }
    }

    try {
      const rawValue = localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (!rawValue) return [];
      return normalizeFavorites(JSON.parse(rawValue));
    } catch (_) {
      return [];
    }
  }

  async function writeFavorites(favorites) {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({
        [FAVORITES_STORAGE_KEY]: favorites
      });
      return;
    }

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
    const content = document.getElementById("eva-ext-content");
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
        ${message ? `<p class="eva-ext-feedback">${escapeHtml(message)}</p>` : ""}
        <p>Aucun favori enregistré pour le moment.</p>
        ${renderFavoriteBuilder(locations, games, seatChoices)}
      `;
      return;
    }

    content.innerHTML = `
      ${message ? `<p class="eva-ext-feedback">${escapeHtml(message)}</p>` : ""}
      <div class="eva-ext-favorites-grid">
        ${favorites.map(favorite => `
        <section class="eva-ext-session eva-ext-favorite-card">
          <h3>${escapeHtml(favorite.label ?? "Favori EVA")}</h3>
          <div class="eva-ext-meta">
            <div><strong>Centre :</strong> ${escapeHtml(favorite.locationName ?? favorite.locationId)}</div>
            <div><strong>Jeu :</strong> ${escapeHtml(favorite.gameName ?? favorite.gameIds)}</div>
            <div><strong>Places :</strong> ${escapeHtml(favorite.seatCount)}</div>
          </div>
          <div class="eva-ext-favorite-actions">
            <button data-action="open-favorite" data-favorite-id="${escapeHtml(favorite.id)}">Ouvrir</button>
            <button data-action="delete-favorite" data-favorite-id="${escapeHtml(favorite.id)}">Supprimer</button>
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
      <details class="eva-ext-session eva-ext-favorite-builder">
        <summary>Créer un favori</summary>
        <div class="eva-ext-form-grid">
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
        <div class="eva-ext-favorite-actions">
          <button data-action="create-favorite-from-builder">Enregistrer</button>
        </div>
      </details>
    `;
  }

  async function handleContentClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const action = button.dataset.action;
    const favoriteId = button.dataset.favoriteId;

    if (action === "create-favorite-from-builder") {
      await saveFavoriteFromBuilder();
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
    const content = document.getElementById("eva-ext-content");
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

    const minPlayers = Number(selectedGameEntry.game?.minPlayer ?? 1);
    const gameMaxPlayers = Number(selectedGameEntry.game?.maxPlayer ?? minPlayers);
    const locationMaxSeats = Number(selectedGameEntry.maxSeatCount ?? gameMaxPlayers);
    const maxPlayers = Math.max(minPlayers, Math.min(gameMaxPlayers, locationMaxSeats));

    return Array.from({ length: maxPlayers - minPlayers + 1 }, (_, index) => String(minPlayers + index));
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

    location.assign(buildBookingCalendarUrl(favorite));
  }

  async function deleteFavoriteById(favoriteId) {
    const favorites = await readFavorites();
    const filteredFavorites = favorites.filter(entry => entry.id !== favoriteId);
    await writeFavorites(filteredFavorites);
    await renderFavoritesTab("Favori supprimé.");
  }

  async function loadUpcomingParticipants() {
    const content = document.getElementById("eva-ext-content");
    content.innerHTML = "Chargement des réservations à venir...";

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

      content.innerHTML = `Chargement des participants pour ${bookings.length} session(s)...`;

      const sessions = await Promise.all(
        bookings.map(async booking => {
          const participantData = await graphql(
            "listParticipants",
            {
              slotId: booking.slot.id,
              terrainId: booking.terrainId
            },
            UPCOMING_PARTICIPANTS_QUERY
          );

          return {
            booking,
            participants: participantData.listParticipants ?? []
          };
        })
      );

      renderUpcomingSessions(sessions);
    } catch (error) {
      renderError(error);
    }
  }

  async function loadHistoryParticipants() {
    const content = document.getElementById("eva-ext-content");
    content.innerHTML = "Chargement complet de l'historique...";

    try {
      const allBookings = await loadAllHistoryBookings();

      const lastTenBookings = allBookings
        .filter(booking => booking.bookingGroupUnitId)
        .sort((a, b) => getBookingTime(b) - getBookingTime(a))
        .slice(0, 10);

      if (!lastTenBookings.length) {
        content.innerHTML = "Aucune session dans l'historique.";
        return;
      }

      content.innerHTML = `Chargement des joueurs des ${lastTenBookings.length} dernières partie(s)...`;

      const sessions = await Promise.all(
        lastTenBookings.map(async booking => {
          // `getBookingGroupUnitById` peut ne retourner que le groupe lié à notre ticket.
          // On tente d'abord les participants de la session complète.
          let participants = [];
          let derivedPlayerCount = booking.playerCount;
          let derivedSeatCount = booking.seatCount;

          try {
            const sessionParticipantsData = await graphql(
              "listParticipants",
              {
                slotId: booking.slot.id,
                terrainId: booking.terrainId
              },
              UPCOMING_PARTICIPANTS_QUERY
            );

            const sessionParticipants = sessionParticipantsData.listParticipants ?? [];

            if (sessionParticipants.length) {
              participants = sessionParticipants.map(p => ({
                username: {
                  displayName: p.isAnonymous ? "Anonyme" : (p.user?.displayName ?? "-"),
                  username: p.isAnonymous ? "Anonyme" : (p.user?.displayName ?? "-"),
                  fullName: "-"
                },
                level: p.experience?.level ?? "-",
                paidSeatCount: 1
              }));
              derivedPlayerCount = Math.max(booking.playerCount ?? 0, sessionParticipants.length);
            }
          } catch (_) {
            // Fallback: on garde la stratégie historique.
          }

          if (!participants.length) {
            const groupUnitData = await graphql(
              "getBookingGroupUnitById",
              {
                id: booking.bookingGroupUnitId
              },
              BOOKING_GROUP_UNIT_QUERY
            );

            const groupUnit = groupUnitData.getBookingGroupUnitById;
            participants = groupUnit?.participants ?? [];
            derivedPlayerCount = groupUnit?.filledSeatCount ?? booking.playerCount;
            derivedSeatCount = groupUnit?.seatCount ?? booking.seatCount;
          }

          return {
            booking: {
              ...booking,
              playerCount: derivedPlayerCount,
              seatCount: derivedSeatCount
            },
            participants
          };
        })
      );

      renderHistorySessions(sessions);
    } catch (error) {
      renderError(error);
    }
  }

  async function loadAllHistoryBookings() {
    const allBookings = [];
    const limit = 50;

    let page = 1;
    let totalCount = null;

    while (totalCount === null || allBookings.length < totalCount) {
      const bookingData = await graphql(
        "getBookingOrderList",
        {
          page: {
            page,
            limit
          },
          filters: {
            bookingPassed: true
          }
        },
        BOOKING_QUERY
      );

      const list = bookingData?.listBookingOrders;
      const nodes = list?.nodes ?? [];

      totalCount = list?.totalCount ?? allBookings.length;

      const pageBookings = extractBookings({
        listBookingOrders: {
          nodes
        }
      });

      allBookings.push(...pageBookings);

      if (!nodes.length) break;

      page += 1;
    }

    return allBookings;
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

  function renderUpcomingSessions(sessions) {
    const content = document.getElementById("eva-ext-content");

    content.innerHTML = sessions.map(({ booking, participants }) => `
      <section class="eva-ext-session">
        ${renderSessionHeader(booking)}
        ${renderUpcomingParticipantsTable(participants)}
      </section>
    `).join("");
  }

  function renderHistorySessions(sessions) {
    const content = document.getElementById("eva-ext-content");

    content.innerHTML = sessions.map(({ booking, participants }) => `
      <section class="eva-ext-session">
        ${renderSessionHeader(booking)}
        ${renderHistoryParticipantsTable(participants)}
      </section>
    `).join("");
  }

  function renderSessionHeader(booking) {
    const date = formatDate(booking.slot.localDatetime);
    const gameName = booking.game?.name ?? "Session EVA";
    const locationName = booking.location?.name ?? "Lieu inconnu";

    return `
      <h3>${escapeHtml(gameName)}</h3>

      <div class="eva-ext-meta">
        <div><strong>Lieu :</strong> ${escapeHtml(locationName)}</div>
        <div><strong>Date :</strong> ${escapeHtml(date)}</div>
        <div><strong>Horaire :</strong> ${escapeHtml(booking.slot.startTime ?? "-")} - ${escapeHtml(booking.slot.endTime ?? "-")}</div>
        <div><strong>Terrain :</strong> ${escapeHtml(booking.terrainId ?? "-")}</div>
        <div><strong>Places :</strong> ${escapeHtml(booking.playerCount ?? "-")} / ${escapeHtml(booking.seatCount ?? "-")}</div>
      </div>
    `;
  }

  function renderUpcomingParticipantsTable(participants) {
    if (!participants.length) {
      return `<p>Aucun participant trouvé.</p>`;
    }

    return `
      <table class="eva-ext-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Nom</th>
            <th>Niveau</th>
            <th>Abonnement</th>
          </tr>
        </thead>
        <tbody>
          ${participants.map((p, index) => `
            <tr>
              <td>${index + 1}</td>
              <td>${p.isAnonymous ? "Anonyme" : escapeHtml(p.user?.displayName ?? "-")}</td>
              <td>${escapeHtml(p.experience?.level ?? "-")}</td>
              <td>${escapeHtml(p.subscriptionPlan ?? "-")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function renderHistoryParticipantsTable(participants) {
    if (!participants.length) {
      return `<p>Aucun participant trouvé.</p>`;
    }

    return `
      <table class="eva-ext-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Pseudo</th>
            <th>Nom complet</th>
            <th>Niveau</th>
            <th>Places</th>
          </tr>
        </thead>
        <tbody>
          ${participants.map((p, index) => `
            <tr>
              <td>${index + 1}</td>
              <td>${escapeHtml(p.username?.displayName ?? p.username?.username ?? "-")}</td>
              <td>${escapeHtml(p.username?.fullName ?? "-")}</td>
              <td>${escapeHtml(p.level ?? "-")}</td>
              <td>${escapeHtml(p.paidSeatCount ?? "-")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function getBookingTime(booking) {
    const value = booking?.slot?.localDatetime;
    const time = new Date(value ?? 0).getTime();

    return Number.isNaN(time) ? 0 : time;
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
    const content = document.getElementById("eva-ext-content");

    if (isAuthError(error?.message)) {
      content.innerHTML = `<p class="eva-ext-auth-required">${escapeHtml(AUTH_REQUIRED_MESSAGE)}</p>`;
      return;
    }

    content.innerHTML = `<pre class="eva-ext-error">${escapeHtml(error.message)}</pre>`;
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