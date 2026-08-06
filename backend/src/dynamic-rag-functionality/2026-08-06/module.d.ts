// mammoth ships no type definitions — a minimal declaration for the two
// functions we use keeps the rest of the module typed.
declare module "mammoth" {
  export interface Options {
    buffer: Buffer;
  }
  export interface Result {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }
  export function extractRawText(options: Options): Promise<Result>;
}
