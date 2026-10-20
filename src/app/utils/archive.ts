import { getFileTypePresetConfig } from "./fileTypes";

const subtitleExtensions: readonly string[] = getFileTypePresetConfig("subtitle").extensions;

/** Archive formats whose subtitle contents can be extracted in the browser. */
export const isArchiveFile = (file: { name: string }): boolean => {
  const name = file.name.toLowerCase();
  return name.endsWith(".zip") || name.endsWith(".rar");
};

const isSubtitleName = (name: string): { base: string; dot: number } | null => {
  const base = name.split("/").pop() ?? name;
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : "";
  return subtitleExtensions.includes(ext) ? { base, dot } : null;
};

/** Keep only subtitle entries; clashing base names get " (n)" appended. */
const toSubtitleFiles = (entries: { path: string; data: Blob | Uint8Array }[]): File[] => {
  const used = new Map<string, number>();
  const files: File[] = [];
  for (const entry of entries) {
    const hit = isSubtitleName(entry.path);
    if (!hit) continue;
    const { base, dot } = hit;
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    const name = count === 0 ? base : dot > 0 ? `${base.slice(0, dot)} (${count})${base.slice(dot)}` : `${base} (${count})`;
    files.push(new File([entry.data as BlobPart], name, { type: "text/plain" }));
  }
  return files;
};

const extractZip = async (archive: File): Promise<File[]> => {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(archive);
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir && !entry.name.startsWith("__MACOSX/") && !entry.name.split("/").some((part) => part.startsWith(".")))
    .sort((a, b) => a.name.localeCompare(b.name));
  const loaded = await Promise.all(entries.map(async (entry) => ({ path: entry.name, data: await entry.async("blob") })));
  return toSubtitleFiles(loaded);
};

// WASM binary is served from /public (copied from node-unrar-js) and cached after first load.
let rarWasm: Promise<ArrayBuffer> | null = null;
const loadRarWasm = () => {
  if (!rarWasm) {
    rarWasm = fetch("/unrar.wasm").then((res) => {
      if (!res.ok) throw new Error(`unrar.wasm HTTP ${res.status}`);
      return res.arrayBuffer();
    });
    rarWasm.catch(() => (rarWasm = null));
  }
  return rarWasm;
};

const extractRar = async (archive: File): Promise<File[]> => {
  const { createExtractorFromData } = await import("node-unrar-js");
  const wasmBinary = await loadRarWasm();
  const extractor = await createExtractorFromData({ wasmBinary, data: await archive.arrayBuffer() });
  const { files } = extractor.extract({});
  const entries: { path: string; data: Uint8Array }[] = [];
  for (const file of files) {
    if (file.fileHeader.flags.directory || !file.extraction) continue;
    entries.push({ path: file.fileHeader.name, data: file.extraction });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return toSubtitleFiles(entries);
};

/**
 * Pull every subtitle file out of a .zip or .rar archive. Folders, macOS metadata
 * and non-subtitle entries are skipped; nested folders are flattened to base names.
 */
export const extractSubtitlesFromArchive = async (archive: File): Promise<File[]> => {
  return archive.name.toLowerCase().endsWith(".rar") ? extractRar(archive) : extractZip(archive);
};
