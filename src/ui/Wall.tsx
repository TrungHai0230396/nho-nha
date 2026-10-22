import type { CSSProperties } from "react";
import { useLook } from "../lib/look";

/** The wallpaper picked in Cài đặt → Giao diện, behind the list; nothing for the plain one. */
export function Wall() {
  const { look, photo } = useLook();
  if (look.wall === "plain") return null;
  if (look.wall !== "photo") return <div className={`wall ${look.wall}`} aria-hidden="true" />;
  if (!photo) return null;
  return <div className="wall photo" aria-hidden="true" style={{ backgroundImage: `url("${photo}")`, "--show": look.show } as CSSProperties} />;
}
