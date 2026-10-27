const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const contentSource = fs.readFileSync(path.join(root, "content.js"), "utf8");
const bridgeSource = fs.readFileSync(path.join(root, "page-bridge.js"), "utf8");
const testSource = contentSource.replace(/\n  init\(\);\s*\}\)\(\);\s*$/, `
  globalThis.testApi = { loadUpcomingParticipants, loadGameHistory, graphql, graphqlPublic };
})();`);
assert.notEqual(testSource, contentSource, "Expose the content entry points without starting the popup");

function makeBooking(gameId, date = "2026-10-28T18:00:00") {
  return {
    id: `booking-${gameId}`,
    terrainId: 156,
    seatCount: 10,
    orderId: "order-1",
    game: { id: gameId, name: `Game ${gameId}` },
    location: { name: "Test EVA" },
    slot: { id: "same-slot", localDatetime: date, startTime: "18:00", endTime: "18:40" }
  };
}

function createHarness({ bookings = [makeBooking(1)], respond, verification = "available" } = {}) {
  const content = { innerHTML: "" };
  const requests = [];
  const verifications = [];
  const listeners = [];
  let tokenCount = 0;
  const pageContext = vm.createContext({
    URL, clearTimeout,
    setTimeout: (callback, delay) => setTimeout(callback, verification === "timeout" ? 0 : delay),
    document: {
      querySelector: () => verification === "missing" ? null : {
        src: "https://www.google.com/recaptcha/api.js?render=test-site-key"
      }
    },
    window: {
      grecaptcha: {
        ready(callback) { if (verification !== "timeout") callback(); },
        async execute(siteKey, options) {
          verifications.push({ siteKey, action: options.action });
          if (verification === "rejected") throw new Error("Verification unavailable");
          return `test-verification-${++tokenCount}`;
        }
      }
    }
  });

  const bridgeContext = vm.createContext({
    window: {},
    chrome: { runtime: { onMessage: { addListener: listener => listeners.push(listener) } } },
    fetch: async (_url, options) => {
      const request = { ...JSON.parse(options.body), headers: options.headers };
      requests.push(request);
      let response = respond?.(request, requests);
      if (!response) {
        switch (request.operationName) {
          case "refreshToken":
            response = { data: { refreshToken: { accessToken: "test-access-token" } } };
            break;
          case "getBookingOrderList": {
            const includesGameId = /game\s*\{\s*id\b/.test(request.query);
            response = { data: { listBookingOrders: { nodes: [{
              id: "order-1", items: bookings.map(booking => {
                const selected = structuredClone(booking);
                if (!includesGameId) delete selected.game.id;
                return { booking: selected };
              })
            }] } } };
            break;
          }
          case "listParticipants":
            if (!request.headers["x-recaptcha-token"]) {
              response = { errors: [{ message: "Forbidder error", extensions: { code: "FORBIDDEN" } }] };
            } else if (!Number.isInteger(request.variables.gameId)) {
              response = { status: 400, errors: [{ message: "gameId Int! is required" }] };
            } else {
              response = { data: { listParticipants: [{
                user: { displayName: `Player ${request.variables.gameId}` },
                experience: { level: 12 }, subscriptionPlan: "Test", isAnonymous: false
              }] } };
            }
            break;
          case "me":
            response = { data: { me: { id: 123 } } };
            break;
          case "listSeasons":
            response = { data: { listSeasons: { nodes: [{ id: 8 }] } } };
            break;
          case "useAfterhGameHistoryPageLastOnly":
            response = { data: { listLastAfterhGameHistoriesByUserAndSeason: [] } };
            break;
          case "listLocations":
            response = { data: { listLocations: [] } };
            break;
          default:
            throw new Error(`Unexpected operation: ${request.operationName}`);
        }
      }
      const { status = 200, ...body } = response;
      return { ok: status >= 200 && status < 300, status, json: async () => body };
    }
  });

  const context = vm.createContext({
    document: { getElementById: () => content },
    chrome: {
      runtime: {},
      tabs: {
        query: async () => [{ id: 1, url: "https://app.eva.gg/fr-FR/account/bookings" }],
        sendMessage(_tabId, message, callback) {
          for (const listener of listeners) listener(message, {}, callback);
        }
      },
      scripting: {
        async executeScript(options) {
          if (options.files) {
            vm.runInContext(bridgeSource, bridgeContext);
            return [];
          }
          assert.equal(options.world, "MAIN");
          // Recreate Chrome's serialization: the injected function cannot use popup globals.
          return [{ result: await vm.runInContext(`(${options.func.toString()})()`, pageContext) }];
        }
      }
    }
  });
  vm.runInContext(testSource, context);
  return { api: context.testApi, content, requests, verifications };
}

test("upcoming participants use a fresh native verification token and each booking gameId", async () => {
  const harness = createHarness({ bookings: [
    makeBooking(7, "2026-10-29T18:00:00"), makeBooking(3)
  ] });
  await harness.api.loadUpcomingParticipants();
  const participantRequests = harness.requests.filter(request => request.operationName === "listParticipants");
  assert.deepEqual(participantRequests.map(request => request.variables), [
    { slotId: "same-slot", terrainId: 156, gameId: 3 },
    { slotId: "same-slot", terrainId: 156, gameId: 7 }
  ]);
  assert.equal(new Set(participantRequests.map(request => request.headers["x-recaptcha-token"])).size, 2);
  assert.deepEqual(harness.verifications, [
    { siteKey: "test-site-key", action: "get_game_session" },
    { siteKey: "test-site-key", action: "get_game_session" }
  ]);
  assert(participantRequests.every(request => request.headers.authorization === "Bearer test-access-token"));
  assert(harness.requests.filter(request => request.operationName !== "listParticipants")
    .every(request => !request.headers["x-recaptcha-token"]));
  assert.match(harness.content.innerHTML, /Player 3/);
  assert.match(harness.content.innerHTML, /Player 7/);
  assert(harness.content.innerHTML.indexOf("Game 3") < harness.content.innerHTML.indexOf("Game 7"));
  assert.doesNotMatch(harness.content.innerHTML, /Connecte-toi|evassistant-error/);
});

for (const verification of ["missing", "rejected", "timeout"]) {
  test(`verification ${verification} keeps bookings visible with a specific error`, async () => {
    const harness = createHarness({ verification });
    await harness.api.loadUpcomingParticipants();
    assert.match(harness.content.innerHTML, /Game 1/);
    assert.match(harness.content.innerHTML, /vérification de sécurité EVA/);
    assert.doesNotMatch(harness.content.innerHTML, /Connecte-toi|Aucun participant trouvé/);
    assert(!harness.requests.some(request => request.operationName === "listParticipants"));
  });
}

test("a forbidden participant request does not hide another session or ask for login", async () => {
  const harness = createHarness({
    bookings: [makeBooking(1), makeBooking(2)],
    respond(request) {
      if (request.operationName === "listParticipants" && request.variables.gameId === 1) {
        return { errors: [{ message: "Forbidder error <details>", extensions: { code: "FORBIDDEN" } }] };
      }
    }
  });
  await harness.api.loadUpcomingParticipants();
  assert.match(harness.content.innerHTML, /Game 1/);
  assert.match(harness.content.innerHTML, /Game 2/);
  assert.match(harness.content.innerHTML, /Player 2/);
  assert.match(harness.content.innerHTML, /Forbidder error &lt;details&gt;/);
  assert.doesNotMatch(harness.content.innerHTML, /Connecte-toi/);
  assert.equal(harness.requests.filter(request => request.operationName === "refreshToken").length, 1);
});

for (const status of [200, 401]) {
  test(`an expired token with HTTP ${status} refreshes once and gets a new verification token`, async () => {
    let participantAttempts = 0;
    const harness = createHarness({ respond(request) {
      if (request.operationName === "listParticipants" && participantAttempts++ === 0) {
        return status === 401
          ? { status, message: "Session expired" }
          : { errors: [{ message: "Session expired", extensions: { code: "UNAUTHENTICATED" } }] };
      }
    } });
    await harness.api.loadUpcomingParticipants();
    assert.equal(harness.requests.filter(request => request.operationName === "refreshToken").length, 2);
    assert.equal(harness.verifications.length, 2);
    assert.match(harness.content.innerHTML, /Player 1/);
    assert.doesNotMatch(harness.content.innerHTML, /Connecte-toi|evassistant-error/);
  });
}

test("a persistent unauthenticated response asks for login after one retry", async () => {
  const harness = createHarness({ respond(request) {
    if (request.operationName === "listParticipants") {
      return { errors: [{ message: "Session expired", extensions: { code: "UNAUTHENTICATED" } }] };
    }
  } });
  await harness.api.loadUpcomingParticipants();
  assert.match(harness.content.innerHTML, /evassistant-auth-required/);
  assert.match(harness.content.innerHTML, /Connecte-toi à ton compte EVA/);
  assert.equal(harness.requests.filter(request => request.operationName === "refreshToken").length, 2);
});

test("a refresh service failure is not reported as a disconnected account", async () => {
  const harness = createHarness({ respond(request) {
    if (request.operationName === "refreshToken") return { status: 503, errors: [{ message: "Service unavailable" }] };
  } });
  await harness.api.loadUpcomingParticipants();
  assert.match(harness.content.innerHTML, /refreshToken \(HTTP 503\)/);
  assert.doesNotMatch(harness.content.innerHTML, /Connecte-toi/);
});

test("upcoming without bookings does not run verification", async () => {
  const harness = createHarness({ bookings: [] });
  await harness.api.loadUpcomingParticipants();
  assert.match(harness.content.innerHTML, /Aucune session à venir trouvée/);
  assert.equal(harness.verifications.length, 0);
});

test("history and public favorite data do not run participant verification", async () => {
  const harness = createHarness();
  await harness.api.loadGameHistory();
  assert.match(harness.content.innerHTML, /Aucune partie dans l'historique/);
  await harness.api.graphqlPublic("listLocations", {}, "query listLocations { listLocations { id } }");
  assert.equal(harness.verifications.length, 0);
});

test("an unrelated 401 in API details is not interpreted as an HTTP authentication status", async () => {
  const harness = createHarness({ respond(request) {
    if (request.operationName === "getBookingOrderList") {
      return { errors: [{ message: "Invalid booking 401", extensions: { code: "BAD_USER_INPUT" } }] };
    }
  } });
  await harness.api.loadUpcomingParticipants();
  assert.match(harness.content.innerHTML, /Invalid booking 401/);
  assert.doesNotMatch(harness.content.innerHTML, /Connecte-toi/);
  assert.equal(harness.requests.filter(request => request.operationName === "refreshToken").length, 1);
});
