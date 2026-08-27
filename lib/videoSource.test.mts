import assert from "node:assert/strict";
import {
  parseKickChannel,
  parseTwitchChannel,
  parseYouTubeVideoId,
  parseYouTubePlaylistId,
  parseYouTubeSource,
  parseVideoSourceInput,
  isLiveChannelSource,
  isYouTubeVideoId,
  videoSourceVolumeKey,
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
assert.equal(isYouTubeVideoId("dQw4w9WgXcQ"), true);
assert.equal(isYouTubeVideoId("PLdO9oLjq6DfI1Ao-pGb44ryC_TY_WuAQF"), false);

const playlistWatch =
  "https://www.youtube.com/watch?v=mJcF1RCOSZA&list=PLdO9oLjq6DfI1Ao-pGb44ryC_TY_WuAQF";
assert.equal(parseYouTubeVideoId(playlistWatch), "mJcF1RCOSZA");
assert.equal(parseYouTubePlaylistId(playlistWatch), "PLdO9oLjq6DfI1Ao-pGb44ryC_TY_WuAQF");
assert.deepEqual(parseYouTubeSource(playlistWatch), {
  videoId: "mJcF1RCOSZA",
  playlistId: "PLdO9oLjq6DfI1Ao-pGb44ryC_TY_WuAQF",
});
assert.equal(parseVideoSourceInput("youtube", playlistWatch), "mJcF1RCOSZA");

const playlistOnly = "https://www.youtube.com/playlist?list=PLdO9oLjq6DfI1Ao-pGb44ryC_TY_WuAQF";
assert.equal(parseYouTubeVideoId(playlistOnly), null);
assert.equal(parseYouTubePlaylistId(playlistOnly), "PLdO9oLjq6DfI1Ao-pGb44ryC_TY_WuAQF");
assert.equal(parseVideoSourceInput("youtube", playlistOnly), "PLdO9oLjq6DfI1Ao-pGb44ryC_TY_WuAQF");

assert.equal(
  parseYouTubePlaylistId("https://youtu.be/mJcF1RCOSZA?list=PLdO9oLjq6DfI1Ao-pGb44ryC_TY_WuAQF"),
  "PLdO9oLjq6DfI1Ao-pGb44ryC_TY_WuAQF"
);
assert.equal(
  parseYouTubePlaylistId("PLdO9oLjq6DfI1Ao-pGb44ryC_TY_WuAQF"),
  "PLdO9oLjq6DfI1Ao-pGb44ryC_TY_WuAQF"
);
assert.equal(parseYouTubePlaylistId("https://www.youtube.com/watch?v=mJcF1RCOSZA&list=WL"), null);
assert.equal(parseYouTubePlaylistId("https://www.youtube.com/watch?v=mJcF1RCOSZA"), null);
assert.deepEqual(parseYouTubeSource("https://www.youtube.com/watch?v=mJcF1RCOSZA&list=WL"), {
  videoId: "mJcF1RCOSZA",
  playlistId: null,
});
assert.equal(
  parseYouTubePlaylistId(
    "https://www.youtube.com/embed/videoseries?list=PLdO9oLjq6DfI1Ao-pGb44ryC_TY_WuAQF"
  ),
  "PLdO9oLjq6DfI1Ao-pGb44ryC_TY_WuAQF"
);
assert.equal(parseYouTubeSource("dQw4w9WgXcQ")?.videoId, "dQw4w9WgXcQ");
assert.equal(parseYouTubeSource("not a url"), null);

assert.equal(
  videoSourceVolumeKey({ videoId: "mJcF1RCOSZA", playlistId: "PLdO9oLjq6DfI1Ao-pGb44ryC_TY_WuAQF" }),
  "video:PLdO9oLjq6DfI1Ao-pGb44ryC_TY_WuAQF"
);
assert.equal(videoSourceVolumeKey({ videoId: "dQw4w9WgXcQ" }), "video:dQw4w9WgXcQ");

assert.equal(isLiveChannelSource("kick"), true);
assert.equal(isLiveChannelSource("twitch"), true);
assert.equal(isLiveChannelSource("youtube"), false);
