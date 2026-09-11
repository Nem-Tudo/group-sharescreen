// node --experimental-strip-types lib/groupLayout.test.mts
//
// How a group's rooms list is arranged and rearranged: the uncategorised
// rooms first, then each category; voice before text inside each; and a drag
// only ever moves a room within its own kind.
import assert from "node:assert/strict";
import {
  applySections,
  buildSections,
  dropOnChannel,
  moveCategory,
  moveChannel,
  toPayload,
} from "./groupLayout";
import type { GroupCategory, GroupChannel } from "./groupsApi";

const room = (id: string, kind: "text" | "voice", categoryId: string | null, position: number): GroupChannel => ({
  id,
  kind,
  name: id,
  categoryId,
  position,
  permissions: {},
  unread: false,
  mentions: 0,
});
const categories: GroupCategory[] = [
  { id: "B", name: "Jogos", position: 1 },
  { id: "A", name: "Geral", position: 0 },
];
const channels = [
  room("t1", "text", null, 0),
  room("v1", "voice", null, 0),
  room("t2", "text", "A", 1),
  room("t3", "text", "A", 0),
  room("v2", "voice", "A", 0),
  room("t4", "text", "B", 0),
  room("ghost", "text", "gone", 0), // a category that no longer exists: uncategorised
];
const ids = (list: GroupChannel[]) => list.map((c) => c.id);
const shape = (sections: ReturnType<typeof buildSections>) =>
  sections.map((s) => `${s.category?.id ?? "-"}:${ids(s.voice).join(",")}|${ids(s.text).join(",")}`);

// 1. Built in order: uncategorised, then categories by position; voice then text, by position.
const sections = buildSections(channels, categories);
assert.deepEqual(shape(sections), ["-:v1|t1,ghost", "A:v2|t3,t2", "B:|t4"]);

// 2. A room moved into another category, before a room of its kind there.
{
  const moved = moveChannel(sections, "t1", "A", "t2");
  assert.deepEqual(shape(moved), ["-:v1|ghost", "A:v2|t3,t1,t2", "B:|t4"]);
}
// ...to the end when there is nothing to be placed before.
{
  const moved = moveChannel(sections, "v1", "B", null);
  assert.deepEqual(shape(moved), ["-:|t1,ghost", "A:v2|t3,t2", "B:v1|t4"]);
}
// ...and never before a room of the other kind: that is read as "the end".
{
  const moved = moveChannel(sections, "t1", "A", "v2");
  assert.deepEqual(shape(moved), ["-:v1|ghost", "A:v2|t3,t2,t1", "B:|t4"]);
}

// 3. Dropping on a room: before it on its upper half, after it on its lower one.
{
  const dragged = channels.find((c) => c.id === "t2")!;
  const target = channels.find((c) => c.id === "t3")!;
  assert.deepEqual(dropOnChannel(sections, dragged, target, false), { categoryId: "A", beforeId: "t3" });
  const t4 = channels.find((c) => c.id === "t4")!;
  assert.deepEqual(dropOnChannel(sections, dragged, t4, true), { categoryId: "B", beforeId: null });
}
// ...and on a room of the other kind: into that section, at the nearest end of its own kind.
{
  const text = channels.find((c) => c.id === "t4")!;
  const voice = channels.find((c) => c.id === "v2")!;
  assert.deepEqual(dropOnChannel(sections, text, voice, false), { categoryId: "A", beforeId: "t3" });
  const v1 = channels.find((c) => c.id === "v1")!;
  const t3 = channels.find((c) => c.id === "t3")!;
  assert.deepEqual(dropOnChannel(sections, v1, t3, false), { categoryId: "A", beforeId: null });
}

// 4. Categories move among themselves; the uncategorised rooms stay on top.
{
  const moved = moveCategory(sections, "B", "A");
  assert.deepEqual(shape(moved), ["-:v1|t1,ghost", "B:|t4", "A:v2|t3,t2"]);
  assert.deepEqual(shape(moveCategory(moved, "B", null)), ["-:v1|t1,ghost", "A:v2|t3,t2", "B:|t4"]);
}

// 5. What is sent, and what the list becomes locally.
{
  const moved = moveChannel(sections, "t1", "B", "t4");
  assert.deepEqual(toPayload(moved), {
    categories: ["A", "B"],
    containers: [
      { categoryId: null, channels: ["v1", "ghost"] },
      { categoryId: "A", channels: ["v2", "t3", "t2"] },
      { categoryId: "B", channels: ["t1", "t4"] },
    ],
  });
  const applied = applySections(moved);
  const t1 = applied.channels.find((c) => c.id === "t1")!;
  assert.equal(t1.categoryId, "B");
  assert.equal(t1.position, 0);
  assert.equal(applied.channels.find((c) => c.id === "ghost")!.categoryId, null, "an orphan is saved as uncategorised");
  assert.deepEqual(applied.categories.map((c) => `${c.id}:${c.position}`), ["A:0", "B:1"]);
  // Built again from what was applied, it is the same list.
  assert.deepEqual(shape(buildSections(applied.channels, applied.categories)), shape(moved));
}

// 6. A group from an older API: no categories, no categoryId — everything uncategorised.
{
  const old = [room("t1", "text", null, 0), room("v1", "voice", null, 0)].map(({ categoryId: _c, ...c }) => {
    void _c;
    return c as GroupChannel;
  });
  assert.deepEqual(shape(buildSections(old)), ["-:v1|t1"]);
}

console.log("groupLayout ok");
