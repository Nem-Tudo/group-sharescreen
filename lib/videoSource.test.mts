import assert from "node:assert/strict";
import {
  parseKickChannel,
  parseTwitchChannel,
  parseYouTubeVideoId,
  parseVideoSourceInput,
  isLiveChannelSource,
} from "./videoSource";

assert.equal(parseKickChannel("xqc"), "xqc");
assert.equal(parseKickChannel("https://kick.com/xqc"), "xqc");
assert.equal(parseKickChannel("kick.com/Trainwreckstv"), "Trainwreckstv");
assert.equal(parseKickChannel("https://www.kick.com/adinross"), "adinross");
assert.equal(parseKickChannel("https://player.kick.com/xqc"), "xqc");
assert.equal(parseKickChannel("https://kick.com/xqc/videos/abc"), null);
assert.equal(parseKickChannel("https://twitch.tv/xqc"), null);
assert.equal(parseKickChannel("ab"), null);

assert.equal(parseVideoSourceInput("kick", "https://kick.com/xqc"), "xqc");
assert.equal(parseVideoSourceInput("twitch", "https://twitch.tv/shroud"), "shroud");
assert.equal(parseTwitchChannel("https://twitch.tv/shroud"), "shroud");
assert.ok(parseYouTubeVideoId("dQw4w9WgXcQ"));

assert.equal(isLiveChannelSource("kick"), true);
assert.equal(isLiveChannelSource("twitch"), true);
assert.equal(isLiveChannelSource("youtube"), false);
