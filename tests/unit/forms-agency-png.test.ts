import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { pngFrame, validateOriginalFile } from "../../scripts/build-forms";

const bytes = readFileSync("tests/fixtures/forms/yeongjong-official-viewer-page-1119.png");
const jpeg = readFileSync("tests/fixtures/forms/bucheon-school-uniform-application.jpg");
const chunk = (type: string, data: Buffer): Buffer => {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  result.write(type, 4, 4, "ascii");
  data.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, 8 + data.length)), 8 + data.length);
  return result;
};

describe("existing whole-image PNG loader boundaries", () => {
  it("reads the exact official fixture without re-encoding it", () => {
    expect(bytes.length).toBe(104896);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("3994b3fd39fdfaf23da605b89d04ddb5a596d43100dcec492a17adf5751984e8");
    expect(pngFrame(bytes)).toEqual({ width: 793, height: 1121 });
    expect(() => validateOriginalFile(bytes, "png")).not.toThrow();
  });

  it("rejects a truncated, corrupt or differently labelled file", () => {
    for (const cut of [8, 32, bytes.length - 1]) expect(() => pngFrame(bytes.subarray(0, cut))).toThrow();
    const changed = Buffer.from(bytes); changed[32] ^= 1;
    expect(() => pngFrame(changed)).toThrow();
    expect(() => pngFrame(Buffer.concat([bytes, Buffer.from("extra")]))).toThrow();
    expect(() => validateOriginalFile(jpeg, "png")).toThrow();
    expect(() => validateOriginalFile(bytes, "jpg")).toThrow();
  });

  it("rejects animation even with a valid animation chunk CRC", () => {
    const animated = Buffer.concat([bytes.subarray(0, 33), chunk("acTL", Buffer.from([0, 0, 0, 2, 0, 0, 0, 0])), bytes.subarray(33)]);
    expect(() => pngFrame(animated)).toThrow();
  });

  it("rejects absent image data and excessive dimensions with valid chunk CRCs", () => {
    const header = Buffer.from(bytes.subarray(16, 29));
    const noData = Buffer.concat([bytes.subarray(0, 8), chunk("IHDR", header), chunk("IEND", Buffer.alloc(0))]);
    expect(() => pngFrame(noData)).toThrow();
    header.writeUInt32BE(10000, 0); header.writeUInt32BE(5001, 4);
    const oversized = Buffer.concat([bytes.subarray(0, 8), chunk("IHDR", header), bytes.subarray(33)]);
    expect(() => pngFrame(oversized)).toThrow();
  });
});
