export interface VaultAdapter {
  read(path: string): Promise<string>
  write(path: string, data: string): Promise<void>
  list(path: string): Promise<{ files: string[]; folders: string[] }>
  exists(path: string): Promise<boolean>
  append?(path: string, data: string): Promise<void>
  rename?(oldPath: string, newPath: string): Promise<void>
  remove?(path: string): Promise<void>
}
