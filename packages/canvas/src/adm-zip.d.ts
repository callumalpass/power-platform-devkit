declare module 'adm-zip' {
  export interface AdmZipEntry {
    entryName: string;
    getData(): Buffer;
  }

  export default class AdmZip {
    constructor(path?: string | Buffer);
    getEntries(): AdmZipEntry[];
    getEntry(name: string): AdmZipEntry | null;
    extractAllTo(targetPath: string, overwrite?: boolean, keepOriginalPermission?: boolean): void;
    addLocalFolder(localPath: string, zipPath?: string): void;
    addFile(entryName: string, content: Buffer, comment?: string, attr?: number): void;
    writeZip(targetFileName: string): void;
  }
}
