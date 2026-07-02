(function () {
  const API_URL = "https://api.eva.gg/graphql";
  const PANEL_ID = "eva-participants-panel";
  const AUTH_REQUIRED_MESSAGE = "Connecte-toi à ton compte EVA pour utiliser l'extension.";

  let cachedAccessToken = null;
  let refreshAccessTokenPromise = null;
  let activeTab = "upcoming";
  let isPanelCollapsed = false;

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
          <button id="eva-ext-open-bookings">Bookings</button>
          <button id="eva-ext-refresh">Rafraîchir</button>
          <button id="eva-ext-toggle" title="Réduire le panneau" aria-label="Réduire le panneau">—</button>
        </div>
      </div>

      <div class="eva-ext-tabs">
        <button class="eva-ext-tab active" data-tab="upcoming">À venir</button>
        <button class="eva-ext-tab" data-tab="history">Historique</button>
      </div>

      <div id="eva-ext-content">Clique sur rafraîchir.</div>
    `;

    document.body.appendChild(panel);

    document
      .getElementById("eva-ext-refresh")
      .addEventListener("click", loadCurrentTab);

    document
      .getElementById("eva-ext-open-bookings")
      .addEventListener("click", () => {
        location.assign(getBookingsUrl());
      });

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

    setPanelCollapsed(false);
  }

  function getBookingsUrl() {
    const localeMatch = location.pathname.match(/^\/([a-z]{2}-[A-Z]{2})(?:\/|$)/);
    const locale = localeMatch?.[1] ?? "fr-FR";
    return `${location.origin}/${locale}/account/bookings`;
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

  function loadCurrentTab() {
    if (activeTab === "history") {
      return loadHistoryParticipants();
    }

    return loadUpcomingParticipants();
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