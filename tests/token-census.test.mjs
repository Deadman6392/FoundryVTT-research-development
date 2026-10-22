/**
 * The token count groups every token in the world by the sidebar actor it was placed from, lists the scenes each
 * actor's tokens are on, and calls out leftover copies of player-owned actors.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { censusTokens, sortCensus, playerNotes, censusToHtml, matchesFilter, NO_ACTOR }
  from "../modules/performance-triage/scripts/lib/token-census.mjs";

const items = n => Array.from({ length: n }, (_, i) => ({ name: `Item ${i}`, system: { description: "x".repeat(500) } }));
const token = (id, actorId, extra = {}) => ({ _id: id, name: extra.name ?? "", actorId, actorLink: false, delta: { items: [] }, ...extra });

function world() {
  return {
    scenes: [
      { _id: "s1", name: "Abbey", folder: "f1", tokens: [
        token("t1", "mongrel", { name: "Clovin Belview", delta: { items: items(10) } }),
        token("t2", "mongrel", { name: "Distrel" }),
        token("t3", "mongrel", { name: "Mongrelfolk" }),
        token("t4", "ireena", { name: "Ireena", actorLink: true }),
        token("t5", "ireena", { name: "Ireena", actorLink: true }),
        token("t6", "gone", { name: "Old Statue" })
      ] },
      { _id: "s2", name: "Castle", folder: "f2", tokens: [
        token("t7", "mongrel", { name: "Mongrelfolk", hidden: true }),
        token("t8", "ireena", { name: "Ireena (copy)", actorLink: false, delta: { items: items(3) } }),
        token("t9", "wolf", { name: "Wolf" })
      ] },
      { _id: "s3", name: "Empty", folder: null, tokens: [] }
    ],
    actors: new Map([
      ["mongrel", { name: "Mongrelfolk", type: "npc", player: false }],
      ["ireena", { name: "Ireena", type: "character", player: true }],
      ["wolf", { name: "Wolf", type: "npc", player: false }]
    ]),
    folders: new Map([["f1", "Abbey"], ["f2", "Castle Ravenloft"]]),
    inUse: new Set(["s2"])
  };
}

test("groups tokens by sidebar actor and lists where they are, most tokens first", () => {
  const c = censusTokens(world());
  assert.equal(c.tokens, 9);
  assert.equal(c.scenes, 2, "scenes with at least one token");
  assert.equal(c.sceneTotal, 3);
  assert.deepEqual(c.actors.map(g => [g.name, g.tokens]),
    [["Mongrelfolk", 4], ["Ireena", 3], ["(no sidebar actor)", 1], ["Wolf", 1]]);
  const mongrel = c.actors.find(g => g.id === "mongrel");
  assert.deepEqual(mongrel.scenes.map(s => [s.name, s.tokens.length]), [["Abbey", 3], ["Castle", 1]]);
  assert.equal(mongrel.most, 3);
  assert.deepEqual(mongrel.names, ["Clovin Belview", "Distrel", "Mongrelfolk"], "the adventure's names for them");
  assert.equal(mongrel.scenes[0].folder, "Abbey");
  assert.equal(mongrel.scenes[1].inUse, true);
  assert.equal(mongrel.scenes[1].tokens[0].hidden, true);
  assert.ok(mongrel.scenes[0].tokens[0].bytes > mongrel.scenes[0].tokens[1].bytes, "item copies make a token larger");
  assert.equal(mongrel.bytes, mongrel.scenes.reduce((n, s) => n + s.bytes, 0));
});

test("tokens whose actor is gone are kept together under one group", () => {
  const g = censusTokens(world()).actors.find(a => a.id === NO_ACTOR);
  assert.equal(g.tokens, 1);
  assert.equal(g.scenes[0].tokens[0].name, "Old Statue");
});

test("player-owned actors: counts, copies stacked on one scene, and unlinked copies", () => {
  const c = censusTokens(world());
  const ireena = c.actors.find(g => g.id === "ireena");
  assert.equal(ireena.player, true);
  assert.deepEqual([ireena.tokens, ireena.linked, ireena.unlinked], [3, 2, 1]);
  const notes = playerNotes(c);
  assert.match(notes[0], /3 tokens on 2 scenes/);
  assert.ok(notes.some(n => n.includes("Ireena ×2 on Abbey")), notes.join("\n"));
  assert.ok(notes.some(n => n.startsWith("Unlinked tokens of player-owned actors: Ireena on Castle.")), notes.join("\n"));
});

test("a world without player tokens says so", () => {
  const input = world();
  input.actors.get("ireena").player = false;
  assert.deepEqual(playerNotes(censusTokens(input)), ["No scene has a token of a player-owned actor."]);
});

test("sorts by any column; a second direction reverses it and ties keep the most tokens first", () => {
  const { actors } = censusTokens(world());
  assert.deepEqual(sortCensus(actors, { key: "name" }).map(g => g.name), ["(no sidebar actor)", "Ireena", "Mongrelfolk", "Wolf"]);
  assert.deepEqual(sortCensus(actors, { key: "name", dir: "desc" }).map(g => g.name)[0], "Wolf");
  assert.deepEqual(sortCensus(actors, { key: "scenes" }).map(g => g.name).slice(0, 2), ["Mongrelfolk", "Ireena"],
    "both are on two scenes; Mongrelfolk has more tokens");
  assert.equal(sortCensus(actors, { key: "bytes" })[0].name, "Mongrelfolk");
  assert.equal(sortCensus(actors, { key: "nonsense" })[0].name, "Mongrelfolk", "unknown keys fall back to tokens");
});

test("renders rows to expand, sortable columns and a button per token", () => {
  const c = censusTokens(world());
  const html = censusToHtml(c, { expanded: new Set(["mongrel"]), filter: { text: "abb", players: true }, measuredMs: 12 });
  const body = id => html.slice(html.indexOf(`data-actor="${id}"`), html.indexOf("</tbody>", html.indexOf(`data-actor="${id}"`)));
  assert.match(body("mongrel"), /class="ptriage-census-detail">/, "an expanded actor shows its scenes");
  assert.match(body("ireena"), /class="ptriage-census-detail" hidden>/, "others start collapsed");
  assert.match(body("mongrel"), /data-action="showToken" data-scene="s1" data-token="t1"/);
  assert.match(body("mongrel"), /Mongrelfolk \(hidden\)/);
  assert.match(body("ireena"), /Ireena \(copy\) \(unlinked\)/, "an unlinked copy of a player's actor is marked");
  assert.match(body("ireena"), /ptriage-badge">player/);
  assert.match(body("mongrel"), /as Clovin Belview, Distrel/);
  assert.match(html, /data-action="sortCensus" data-key="tokens" class="ptriage-sort">Tokens ▼/, "default sort is marked");
  assert.match(html, /value="abb"/, "the filter text survives a re-render");
  assert.match(html, /name="censusPlayers" checked/);
  assert.match(html, /Counted in 12 ms/);
});

test("escapes names taken from the world", () => {
  const input = world();
  input.actors.get("wolf").name = "<img src=x onerror=alert(1)>";
  const html = censusToHtml(censusTokens(input));
  assert.ok(!html.includes("<img src=x"));
});

test("the filter matches actor, token and scene names, and can keep only player-owned actors", () => {
  const html = censusToHtml(censusTokens(world()));
  const search = id => {
    const m = html.match(new RegExp(`data-actor="${id}" data-search="([^"]*)" data-player="(\\d)"`));
    return { search: m[1].replace(/&#39;/g, "'"), player: m[2] === "1" };
  };
  assert.ok(matchesFilter(search("mongrel"), { text: "clovin" }), "a token name");
  assert.ok(matchesFilter(search("mongrel"), { text: " CASTLE " }), "a scene name, any case");
  assert.ok(!matchesFilter(search("wolf"), { text: "abbey" }));
  assert.ok(!matchesFilter(search("mongrel"), { players: true }));
  assert.ok(matchesFilter(search("ireena"), { players: true, text: "" }));
});

test("sidebar actors no scene uses get a row, with their size, folder and the links that would break", () => {
  // Real-looking 16 character ids, since links are only recognised by Foundry's id format
  const STRAHD = "strahd0000000000";
  const BAT = "bat0000000000000";
  const input = world();
  input.actors.set(STRAHD, { name: "Strahd", type: "npc", player: false, bytes: 400_000, folder: "NPCs / Castle" });
  input.actors.set(BAT, { name: "Bat", type: "npc", player: false, bytes: 9_000, folder: "" });
  input.actors.set("oldpc", { name: "Old PC", type: "character", player: true, bytes: 600_000 });
  input.journals = [{ _id: "j1", name: "Strahd's Letter",
    pages: [{ text: { content: `@UUID[Actor.${STRAHD}] and @UUID[Compendium.world.npcs.Actor.${BAT}]` } }] }];
  input.macros = [{ _id: "m1", name: "Summon", command: `fromUuid("Actor.${STRAHD}")` }];
  const c = censusTokens(input);
  const strahd = c.actors.find(g => g.name === "Strahd");
  assert.deepEqual([strahd.tokens, strahd.actorBytes, strahd.folder], [0, 400_000, "NPCs / Castle"]);
  assert.deepEqual(strahd.links, [{ type: "journal", name: "Strahd's Letter" }, { type: "macro", name: "Summon" }]);
  assert.deepEqual(c.actors.find(g => g.name === "Bat").links, [], "a link to a compendium copy isn't a link to the world actor");
  assert.ok(c.actors.indexOf(strahd) < c.actors.indexOf(c.actors.find(g => g.name === "Bat")),
    "among actors with no tokens, the heaviest come first");
  assert.equal(sortCensus(c.actors, { key: "actorBytes" })[0].name, "Old PC");

  const html = censusToHtml(c, { expanded: new Set([STRAHD]) });
  assert.match(html, /On no scene, no player owner<\/span><strong>2 \(399\.4 KB\)/, "a player's character isn't a candidate");
  assert.match(html, /Sidebar actors on a scene<\/span><strong>3 of 6/);
  assert.match(html, /No token on a world scene uses this actor \(folder: NPCs \/ Castle\)/);
  assert.match(html, /Linked from Strahd&#39;s Letter \(journal\), Summon \(macro\)/);
  assert.match(html, /data-key="actorBytes" class="ptriage-sort">Actor data/);
  assert.ok(matchesFilter({ search: "strahd", player: false, tokens: 0 }, { unused: true }));
  assert.ok(!matchesFilter({ search: "wolf", player: false, tokens: 1 }, { unused: true }));
  assert.ok(matchesFilter({ search: "npcs / castle\nstrahd", player: false, tokens: 0 }, { text: "castle" }), "folders are searchable");
  assert.deepEqual(playerNotes(c).slice(0, 1), playerNotes(censusTokens(world())).slice(0, 1),
    "a player's character with no token doesn't change the player summary");
});
