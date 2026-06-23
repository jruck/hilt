/**
 * Shared clipboard write with the legacy textarea/execCommand fallback.
 *
 * Lifted from the (previously duplicated) implementations in BridgeTaskPanel.writeClipboardText and
 * LibraryArtifactDetailPane.copyText so every "Copy reference" / "Copy path" affordance goes through
 * one path. Surfaces that previously called navigator.clipboard with no fallback (e.g. the MapView
 * "Copy session ID", which was reported broken) gain the fallback for free by routing through here.
 */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (!copied) throw new Error("Clipboard copy failed");
  }
}
