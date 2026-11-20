// Small, uncompressed ZIP for a bounded in-memory pass package. No file paths from callers.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
  return n >>> 0;
});
export function passZip(entries) {
  if (!entries.length || entries.length > 32) throw new Error('Invalid pass archive.');
  const records = [], catalogue = [];
  let pos = 0, dirSize = 0;
  for (const [name, data] of entries) {
    if (!/^(?:[a-zA-Z0-9_@-]+\.(?:png|json)|signature)$/.test(name) || !Buffer.isBuffer(data) || data.length > 1024 * 1024) throw new Error('Invalid pass file.');
    const filename = Buffer.from(name, 'ascii');
    let crc = 0xffffffff;
    for (const value of data) crc = (crc >>> 8) ^ crcTable[(crc ^ value) & 255];
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(pos, 42);
    records.push(local, filename, data); catalogue.push(central, filename);
    pos += local.length + filename.length + data.length; dirSize += central.length + filename.length;
  }
  const last = Buffer.alloc(22);
  last.writeUInt32LE(0x06054b50, 0); last.writeUInt16LE(entries.length, 8); last.writeUInt16LE(entries.length, 10);
  last.writeUInt32LE(dirSize, 12); last.writeUInt32LE(pos, 16);
  return Buffer.concat([...records, ...catalogue, last]);
}
