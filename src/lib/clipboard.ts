/**
 * Text onto the clipboard, true if it got there. The Clipboard API first;
 * an in-app browser that lacks it (or refuses it) still honours the old
 * copy command on a selected field.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      // Neither way: the caller says how to copy by hand.
    }
    field.remove();
    return ok;
  }
}
