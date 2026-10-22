/**
 * Lowercase, drop Vietnamese tone and vowel marks, turn punctuation into
 * spaces — so "mi tom" finds "Mì tôm", "DAU AN" finds "Dầu ăn", and a voice
 * result that comes back as "Mì tôm." still matches.
 *
 * "đ" needs its own rule: it is a letter of its own, not "d" plus a mark,
 * so NFD leaves it alone.
 */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
