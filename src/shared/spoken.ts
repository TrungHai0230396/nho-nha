// What the microphone hands over, made into what the parser reads. A
// recognizer writes most numbers as digits, but not always ("tám giờ",
// "mười giờ rưỡi"), and it never writes the comma a speaker means by a
// pause between the things of a list.

const ONE = "một|hai|ba|bốn|năm|sáu|bảy|bẩy|tám|chín";
const AFTER_TEN = "mốt|một|hai|ba|bốn|tư|lăm|năm|sáu|bảy|bẩy|tám|chín";
/** A number said in words, 1 to 59: "tám", "mười lăm", "hai mươi", "bốn mươi lăm". */
const NUMBER = `(?:(?:${ONE})\\s+mươi(?:\\s+(?:${AFTER_TEN}))?|mười(?:\\s+(?:${AFTER_TEN}))?|${ONE})`;
const DIGIT: Record<string, number> = { "một": 1, "mốt": 1, "hai": 2, "ba": 3, "bốn": 4, "tư": 4, "năm": 5, "lăm": 5, "sáu": 6, "bảy": 7, "bẩy": 7, "tám": 8, "chín": 9 };

function value(words: string): number {
  const w = words.toLowerCase().split(/\s+/);
  if (w[0] === "mười") return 10 + (w[1] ? DIGIT[w[1]]! : 0);
  if (w[1] === "mươi") return DIGIT[w[0]!]! * 10 + (w[2] ? DIGIT[w[2]]! : 0);
  return DIGIT[w[0]!]!;
}

const edge = "(?<![\\p{L}\\p{N}])";
const end = "(?![\\p{L}\\p{N}])";
/** A count, not a date: "ngày hai lần" is twice a day, "năm mới" the new year. */
const NOT_A_DATE = "(?!\\s+(?:lần|bữa|lượt|viên|cữ|mới|nay|ngoái|xưa))";
/** Before a unit: "tám giờ", "hai tiếng", "mười lăm phút", "ba hôm nữa". */
// Not after "mỗi", "hằng"…: "mỗi năm ngày 12 tháng 5" is every year, not five days.
const BEFORE_UNIT = new RegExp(`${edge}(?<!(?:mỗi|hằng|hàng|cuối|đầu|sang|qua)\\s+)(${NUMBER})(?=\\s+(?:giờ|tiếng|phút|ngày|hôm|tuần|tháng)${end})`, "giu");
/** After the word that says what it is: "8 giờ mười lăm", "kém mười lăm", "ngày hai mươi", "tháng mười một", "mùng một". */
const AFTER_WORD = new RegExp(`((?:\\d+\\s+giờ|${edge}kém|${edge}ngày|${edge}tháng|${edge}mùng|${edge}mồng)\\s+)(${NUMBER})${end}${NOT_A_DATE}`, "giu");
/** Before "rưỡi": "bảy rưỡi tối". */
const BEFORE_HALF = new RegExp(`${edge}(${NUMBER})(?=\\s+rưỡi${end})`, "giu");

/**
 * Spoken times and dates in digits: "tám giờ sáng mai" → "8 giờ sáng mai",
 * "mười giờ rưỡi" → "10 giờ 30", "bảy rưỡi tối" → "7 giờ 30 tối", "một
 * tiếng rưỡi nữa" → "90 phút nữa", "ngày hai mươi tháng mười một" → "ngày
 * 20 tháng 11", "mùng một" → "mùng 1". Only beside the word that makes it
 * a time or a date: "thứ năm", "năm nay" and "mua hai con cá" stay words.
 */
export function normalizeSpoken(text: string): string {
  return text
    .replace(BEFORE_UNIT, (m) => String(value(m)))
    .replace(AFTER_WORD, (_, head: string, n: string) => `${head}${value(n)}`)
    .replace(BEFORE_HALF, (m) => String(value(m)))
    .replace(/(\d+)\s+giờ\s+rưỡi/giu, "$1 giờ 30")
    .replace(/(\d+)\s+tiếng\s+rưỡi/giu, (_, h: string) => `${Number(h) * 60 + 30} phút`)
    // "7 rưỡi tối": an hour and a half, with no "giờ" said.
    .replace(new RegExp(`${edge}(\\d{1,2})\\s+rưỡi${end}`, "gu"), (m, h: string) => (Number(h) <= 24 ? `${h} giờ 30` : m));
}

/** The buying or bringing words a list said aloud starts with (parse.ts reads the same). */
const LIST_WORD = /(?<![\p{L}\p{N}])(?:cần mua|nhớ mua|mua|gồm có|gồm|lấy|mang theo|mang|đem theo|đem|chuẩn bị|sắm)(?=\s)/iu;

/**
 * The words heard, with a comma where the speaker paused between the
 * things of a list: "đi chợ mua cá … đường … muối" has no other mark, and
 * parse.ts needs one to see a list. `pauses` are the word counts at which a
 * pause came while listening. Only after a buying or bringing word, so a
 * hesitation elsewhere ("gọi … mẹ") does not end up as "gọi, mẹ"; never
 * before the first word or after the last; and not at all when the
 * recognizer wrote commas of its own.
 */
export function commaAtPauses(text: string, pauses: readonly number[]): string {
  if (text.includes(",")) return text;
  const verb = LIST_WORD.exec(text);
  if (!verb) return text;
  const words = text.trim().split(/\s+/).filter(Boolean);
  const verbEnd = text.slice(0, verb.index + verb[0].length).trim().split(/\s+/).length;
  const at = new Set(pauses.filter((n) => n > verbEnd && n < words.length));
  return words.map((w, i) => (at.has(i + 1) ? `${w},` : w)).join(" ");
}
