import { Check, ImagePlus, Plus } from "lucide-react";
import type { ChangeEvent } from "react";
import { toast } from "../app/state";
import { DEFAULT_COLOR, derive, inkOn, LIGHT, PRESETS } from "../lib/color";
import { resetLook, setLook, setPhoto, useLook, type Scheme, type Wall } from "../lib/look";

const WALLS: [Wall, string][] = [
  ["plain", "Trơn"],
  ["glow", "Loang"],
  ["dots", "Chấm bi"],
  ["grid", "Kẻ ô"],
];
const SCHEMES: [Scheme, string][] = [
  ["auto", "Theo máy"],
  ["light", "Sáng"],
  ["dark", "Tối"],
];

// A swatch shows the button colour a pick gives, not the pick itself: a
// pale pink makes mid-pink buttons, and the row should say so up front.
const swatches = new Map<string, string>();
function swatch(hex: string): string {
  let s = swatches.get(hex);
  if (!s) swatches.set(hex, (s = derive(LIGHT, hex).primary));
  return s;
}

/**
 * Colour, wallpaper, light or dark: each applies the moment it is tapped,
 * the Settings sheet itself changing first. Any colour can be picked; the
 * app works out the shades that keep it readable (lib/color).
 */
export function LookSettings() {
  const { look, photo } = useLook();
  const color = look.color ?? DEFAULT_COLOR;
  const custom = !PRESETS.some((p) => p.hex === color);
  const changed = look.color !== null || look.wall !== "plain" || look.scheme !== "auto";

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Cleared, so choosing the same photo again still counts.
    e.target.value = "";
    if (!file) return;
    try {
      await setPhoto(file);
    } catch {
      toast("Chưa dùng được ảnh này. Thử ảnh khác.");
    }
  };

  return (
    <div className="look">
      <div className="field">
        <span id="look-color">Màu</span>
        <div className="look-swatches" role="radiogroup" aria-labelledby="look-color">
          {PRESETS.map((p) => {
            const on = p.hex === color;
            const bg = swatch(p.hex);
            return (
              <button key={p.hex} type="button" role="radio" aria-checked={on} aria-label={p.name} className="swatch" style={{ background: bg, color: inkOn(bg) }} onClick={() => setLook({ color: p.hex === DEFAULT_COLOR ? null : p.hex })}>
                {on && <Check size={22} aria-hidden="true" />}
              </button>
            );
          })}
          <label className={`swatch custom${custom ? " on" : ""}`} style={custom ? { background: swatch(color), color: inkOn(swatch(color)) } : undefined}>
            {custom ? <Check size={22} aria-hidden="true" /> : <Plus size={22} aria-hidden="true" />}
            <input type="color" value={color} onChange={(e) => setLook({ color: e.target.value.toLowerCase() })} aria-label="Tự chọn màu khác" />
          </label>
        </div>
      </div>

      <div className="field">
        <span id="look-wall">Nền</span>
        <div className="look-walls" role="radiogroup" aria-labelledby="look-wall">
          {WALLS.map(([w, name]) => (
            <button key={w} type="button" role="radio" aria-checked={look.wall === w} className="wall-tile" onClick={() => setLook({ wall: w })}>
              <span className={`wall-prev ${w}`} aria-hidden="true" />
              {name}
            </button>
          ))}
          {photo ? (
            <button type="button" role="radio" aria-checked={look.wall === "photo"} className="wall-tile" onClick={() => setLook({ wall: "photo" })}>
              <span className="wall-prev photo" style={{ backgroundImage: `url("${photo}")` }} aria-hidden="true" />
              Ảnh
            </button>
          ) : (
            <label className="wall-tile">
              <span className="wall-prev add" aria-hidden="true">
                <ImagePlus size={22} />
              </span>
              Ảnh
              <input type="file" accept="image/*" className="file-over" onChange={(e) => void pick(e)} aria-label="Chọn ảnh làm nền" />
            </label>
          )}
        </div>
        {look.wall === "photo" && photo && (
          <div className="photo-tools">
            <label className="range">
              Ảnh rõ
              <input type="range" min={0.2} max={1} step={0.05} value={look.show} onChange={(e) => setLook({ show: Number(e.target.value) })} />
            </label>
            <label className="btn ghost">
              Đổi ảnh
              <input type="file" accept="image/*" className="file-over" onChange={(e) => void pick(e)} />
            </label>
          </div>
        )}
      </div>

      <div className="field">
        <span id="look-scheme">Sáng / tối</span>
        <div className="seg" role="radiogroup" aria-labelledby="look-scheme">
          {SCHEMES.map(([s, name]) => (
            <button key={s} type="button" role="radio" aria-checked={look.scheme === s} className={look.scheme === s ? "on" : undefined} onClick={() => setLook({ scheme: s })}>
              {name}
            </button>
          ))}
        </div>
      </div>

      <p className="small look-foot">
        Chỉ đổi trên máy này.
        {changed && (
          <button type="button" className="link" onClick={() => void resetLook()}>
            Về như cũ
          </button>
        )}
      </p>
    </div>
  );
}
