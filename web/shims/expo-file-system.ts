// Browser stand-in for expo-file-system's File: the site passes blob: object URLs
// (see lib/web.ts) and src/lib/api/supabase.ts only calls `.bytes()`.
export class File {
  constructor(private readonly uri: string) {}

  async bytes(): Promise<Uint8Array> {
    const res = await fetch(this.uri.split('#')[0]);
    return new Uint8Array(await res.arrayBuffer());
  }
}
