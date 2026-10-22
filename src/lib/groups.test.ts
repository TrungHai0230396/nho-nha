import { describe, expect, it } from "vitest";
import type { Note } from "../shared/protocol";
import { fromWall, VN_OFFSET } from "../shared/wall";
import { eachLine, HAVE_APP, inviteIn, leftAfterTap, whoLine } from "./groups";
import { markDone, newNote, sections } from "./notes";

const CODE = "g_AbCdEfGhIjKlMnOpQrStUv.0123456789abcdef0123456789abcdef";
const LINK = `https://nho-nha.pages.dev/?moi=${CODE}`;

describe("an invite pasted into the app", () => {
  it("is found in the link, the bare code, or the whole message copied out of Zalo", () => {
    expect(inviteIn(LINK)).toBe(CODE);
    expect(inviteIn(`  ${CODE}\n`)).toBe(CODE);
    expect(inviteIn(`Vào nhóm "Gia đình" trên Nhớ Nha để cùng được nhắc việc chung. ${HAVE_APP}\n${LINK}`)).toBe(CODE);
  });

  it("survives what a sentence leaves on the end of a link, and the link's own escaping", () => {
    expect(inviteIn(`Link nè: ${LINK}.`)).toBe(CODE);
    expect(inviteIn(`(${LINK})`)).toBe(CODE);
    expect(inviteIn(`https://nho-nha.pages.dev/?x=1&moi=${encodeURIComponent(CODE)}`)).toBe(CODE);
  });

  it("is nothing in anything else", () => {
    for (const t of ["", "0912345678", "https://nho-nha.pages.dev/", "https://nho-nha.pages.dev/?moi=g_short.123", "g_AbCdEfGhIjKlMnOpQrStUv.XYZ"]) expect(inviteIn(t), t).toBeNull();
  });
});

describe("whether the others have tapped, once this person has", () => {
  const at = (d: number, h: number, mi = 0) => fromWall(2026, 10, d, h, mi, VN_OFFSET);
  const G = "g_AbCdEfGhIjKlMnOpQrStUv";
  const me = { key: "key-hai-0001", name: "Hải", me: true, owner: true, push: true };
  const lan = { key: "key-lan-0001", name: "Lan", me: false, owner: false, push: true };
  const bo = { key: "key-bo-00001", name: "Bố", me: false, owner: false, push: true };
  const family = [me, lan, bo];
  const tick = (m: typeof lan, t: number, occ?: number) => ({ key: m.key, name: m.name, at: t, me: false, ...(occ !== undefined ? { occ } : {}) });
  const meds: Note = { ...newNote("meds-note-000000001", "9h, 18h hằng ngày uống thuốc", at(14, 8), VN_OFFSET), group: G, each: true };
  const party: Note = { ...newNote("party-note-00000001", "19h đi nhậu", at(14, 8), VN_OFFSET), group: G, each: true };

  it("counts while this person has not tapped", () => {
    const n = { ...meds, ticks: [tick(lan, at(14, 9, 2), at(14, 9))] };
    expect(eachLine(n, family, at(14, 9, 30), VN_OFFSET)).toBe("1/3 xong");
  });

  it("says who is left after the tap, the tap counted at once, before any sync", () => {
    const mine = markDone({ ...meds, ticks: [tick(lan, at(14, 9, 2), at(14, 9))] }, at(14, 9, 30), VN_OFFSET);
    // The row now shows 18:00: the words are about the last time.
    expect(eachLine(mine, family, at(14, 9, 31), VN_OFFSET)).toBe("lần trước còn Bố");
    expect(leftAfterTap(mine, family, VN_OFFSET)).toBe("Còn Bố chưa bấm");
    const all = { ...mine, ticks: [...mine.ticks, tick(bo, at(14, 9, 40), at(14, 9))] };
    expect(eachLine(all, family, at(14, 9, 41), VN_OFFSET)).toBe("lần trước cả nhóm xong");
    expect(leftAfterTap(all, family, VN_OFFSET)).toBe("Cả nhóm đã xong");
    // The evening comes: counted again from nobody.
    expect(eachLine(all, family, at(14, 18, 1), VN_OFFSET)).toBe("0/3 xong");
  });

  it("calls them as this phone does, and counts past three", () => {
    const n = markDone(party, at(14, 19, 5), VN_OFFSET);
    expect(eachLine(n, family, at(14, 19, 6), VN_OFFSET, { [bo.key]: "Ba" })).toBe("còn Lan và Ba");
    const many = [me, lan, bo, ...["a", "b"].map((x) => ({ ...lan, key: `key-${x}-00000001`, name: x.toUpperCase() }))];
    expect(eachLine(n, many, at(14, 19, 6), VN_OFFSET)).toBe("còn 4 người");
    expect(whoLine([lan.key, bo.key], family)).toBe("Lan và Bố");
  });

  it("says nothing before the first time of a repeating one", () => {
    expect(eachLine(meds, family, at(14, 8, 30), VN_OFFSET)).toBeNull();
  });

  it("keeps a one-off this person ticked in sight while the others have not, for a day", () => {
    const membersOf = () => family;
    const n = markDone(party, at(14, 19, 5), VN_OFFSET);
    expect(sections([n], at(14, 19, 6), VN_OFFSET, "", null, membersOf).waiting).toHaveLength(1);
    const all = { ...n, ticks: [tick(lan, at(14, 19, 7)), tick(bo, at(14, 19, 8))] };
    expect(sections([all], at(14, 19, 9), VN_OFFSET, "", null, membersOf).done).toHaveLength(1);
    expect(sections([n], at(15, 19, 6), VN_OFFSET, "", null, membersOf).done).toHaveLength(1);
    // Not knowing the group: done, as before.
    expect(sections([n], at(14, 19, 6), VN_OFFSET).done).toHaveLength(1);
  });
});
