import { getFileTypePresetConfig } from "./fileTypes";

const subtitleExtensions: readonly string[] = getFileTypePresetConfig("subtitle").extensions;

/** True when the dropped file is a zip archive (rar is not supported yet). */
export const isZipFile = (file: { name: string }): boolean => file.name.toLowerCase().endsWith(".zip");

/**
 * Pull every subtitle file out of a zip archive. Folders, macOS metadata
 * (__MACOSX / dot-files) and non-subtitle entries are skipped. Nested folders are
 * flattened to their base name; clashing names get " (n)" appended.
 */
export const extractSubtitlesFromZip = async (archive: File): Promise<File[]> => {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(archive);

  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir && !entry.name.startsWith("__MACOSX/") && !entry.name.split("/").some((part) => part.startsWith(".")))
    .sort((a, b) => a.name.localeCompare(b.name));

  const used = new Map<string, number>();
  const files: File[] = [];

  for (const entry of entries) {
    const base = entry.name.split("/").pop() ?? entry.name;
    const dot = base.lastIndexOf(".");
    const ext = dot > 0 ? base.slice(dot).toLowerCase() : "";
    if (!subtitleExtensions.includes(ext)) continue;

    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    const name = count === 0 ? base : dot > 0 ? `${base.slice(0, dot)} (${count})${base.slice(dot)}` : `${base} (${count})`;

    const blob = await entry.async("blob");
    files.push(new File([blob], name, { type: "text/plain" }));
  }

  return files;
};
