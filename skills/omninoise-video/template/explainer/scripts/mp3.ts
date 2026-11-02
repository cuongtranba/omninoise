/**
 * Duration of an mp3 by walking its MPEG frame headers, the way nv measures it
 * (internal/mp3): a leading Xing/Info frame is a header, not audio, and is not
 * counted. Shared by the English and Vietnamese voice-over scripts so both write
 * the same `seconds` into their manifest.
 */
export const mp3Seconds = (data: Uint8Array): number => {
  let i = 0
  if (data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) {
    i = 10 + (((data[6]! & 0x7f) << 21) | ((data[7]! & 0x7f) << 14) | ((data[8]! & 0x7f) << 7) | (data[9]! & 0x7f))
  }
  const bitratesV1L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
  const bitratesV2L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
  const ratesV1 = [44100, 48000, 32000]
  const ratesV2 = [22050, 24000, 16000]
  let samples = 0
  let rate = 0
  while (i + 4 <= data.length) {
    const b1 = data[i + 1]!
    const b2 = data[i + 2]!
    if (data[i] !== 0xff || (b1 & 0xe0) !== 0xe0) { i++; continue }
    const version = (b1 >> 3) & 3
    const layer = (b1 >> 1) & 3
    const bitrateIndex = b2 >> 4
    const rateIndex = (b2 >> 2) & 3
    if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) { i++; continue }
    const mpeg1 = version === 3
    const bitrate = (mpeg1 ? bitratesV1L3 : bitratesV2L3)[bitrateIndex]! * 1000
    rate = (mpeg1 ? ratesV1 : ratesV2)[rateIndex]! >> (version === 0 ? 1 : 0)
    const perFrame = mpeg1 ? 1152 : 576
    const size = Math.floor(((mpeg1 ? 144 : 72) * bitrate) / rate) + ((b2 >> 1) & 1)
    // A leading Xing/Info frame is a header, not audio; nv does not count it.
    const header = String.fromCharCode(...data.subarray(i + 4, i + 4 + 60).filter((byte) => byte >= 32 && byte < 127))
    if (!(samples === 0 && /Xing|Info/.test(header))) samples += perFrame
    i += size
  }
  return samples / rate
}
