declare module 'adm-zip' {
  export interface AdmZipEntry {
    entryName: string;
    getData(): Buffer;
  }

  export default class AdmZip {
    constructor(path?: string | Buffer);
    getEntries(): AdmZipEntry[];
    getEntry(name: string): AdmZipEntry | null;
    readAsText(entry: string | AdmZipEntry): string;
    extractAllTo(targetPath: string, overwrite?: boolean, keepOriginalPermission?: boolean): void;
    addLocalFolder(localPath: string, zipPath?: string): void;
    addLocalFile(localPath: string, zipPath?: string, zipName?: string): void;
    writeZip(targetFileName: string): void;
  }
}
