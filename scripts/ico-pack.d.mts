export declare const PNG_SIGNATURE: Buffer

export interface IcoFrame {
  size: number
  png: Buffer
}

export interface IcoDirectoryEntry {
  size: number
  height: number
  bytes: number
  offset: number
}

export declare function packPngsToIco(frames: IcoFrame[]): Buffer

export declare function readIcoDirectory(buffer: Buffer): IcoDirectoryEntry[]
