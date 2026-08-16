import sharpModule from "sharp";

type SharpInput = Buffer | {
  create: {
    width: number;
    height: number;
    channels: 3 | 4;
    background: string;
  };
};

type SharpPipeline = {
  png: () => SharpPipeline;
  rotate: () => SharpPipeline;
  resize: (options: {
    width: number;
    height: number;
    fit: "inside";
    withoutEnlargement: boolean;
  }) => SharpPipeline;
  webp: (options: { quality: number; effort: number }) => SharpPipeline;
  toBuffer: () => Promise<Buffer>;
};

type SharpFactory = (
  input: SharpInput,
  options?: { animated?: boolean; sequentialRead?: boolean },
) => SharpPipeline;

// sharp 0.35's ESM declaration currently exposes its callable default as
// unknown under TypeScript's bundler resolution. Keep the compatibility cast
// in one small adapter so image code remains fully typed.
export const sharp = sharpModule as unknown as SharpFactory;
