export interface QrisInfo {
  cleanedPayload: string;
  merchantName: string;
  merchantCity: string;
  nmid: string;
}

interface TlvEntry {
  tag: string;
  value: string;
}

export function crc16Ccitt(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let crc = 0xffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;
    for (let bit = 0; bit < 8; bit++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function parseTlv(payload: string): TlvEntry[] {
  const entries: TlvEntry[] = [];
  let idx = 0;
  while (idx < payload.length) {
    if (idx + 4 > payload.length) {
      throw new Error('Format kode QRIS tidak lengkap (header TLV terpotong).');
    }
    const tag = payload.slice(idx, idx + 2);
    const lenStr = payload.slice(idx + 2, idx + 4);
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lenStr)) {
      throw new Error('Format kode QRIS tidak valid.');
    }
    const len = Number(lenStr);
    const start = idx + 4;
    const end = start + len;
    if (end > payload.length) {
      throw new Error(`Format panjang tag QRIS (${tag}) tidak sesuai.`);
    }
    entries.push({ tag, value: payload.slice(start, end) });
    idx = end;
  }
  return entries;
}

function formatTlv(tag: string, value: string): string {
  const len = String(value.length).padStart(2, '0');
  return `${tag}${len}${value}`;
}

export function parseQrisInfo(rawPayload: string): QrisInfo {
  const cleaned = String(rawPayload || '').replace(/[\r\n]+/g, '').trim();
  if (!cleaned) {
    throw new Error('Kode QRIS belum diisi.');
  }

  const entries = parseTlv(cleaned);
  const tagMap = new Map(entries.map((e) => [e.tag, e.value]));

  if (tagMap.get('00') !== '01') {
    throw new Error('Payload bukan standar QRIS / EMVCo yang valid (Tag 00 harus 01).');
  }

  const hasMerchantTag = entries.some((e) => {
    const n = Number(e.tag);
    return n >= 26 && n <= 51;
  });
  if (!hasMerchantTag) {
    throw new Error('Data merchant QRIS tidak ditemukan dalam kode.');
  }

  const crcEntry = tagMap.get('63');
  if (crcEntry !== undefined) {
    const crcIndex = cleaned.lastIndexOf('6304');
    if (crcIndex === -1 || crcIndex + 8 !== cleaned.length) {
      throw new Error('Checksum QRIS (Tag 63) tidak valid.');
    }
    const expectedCrc = crc16Ccitt(cleaned.slice(0, crcIndex + 4));
    if (crcEntry.toUpperCase() !== expectedCrc) {
      throw new Error('Checksum CRC-16 QRIS tidak cocok. Pastikan kode QRIS tidak terpotong.');
    }
  }

  let nmid = '';
  const tag51 = tagMap.get('51');
  if (tag51) {
    try {
      const sub = parseTlv(tag51);
      nmid = sub.find((s) => s.tag === '02')?.value || '';
    } catch {
      // ignore sub-TLV parsing failure
    }
  }

  return {
    cleanedPayload: cleaned,
    merchantName: tagMap.get('59')?.trim() || 'SAHABAT Accessories & Service',
    merchantCity: tagMap.get('60')?.trim() || '',
    nmid,
  };
}

export function generateDynamicQris(staticPayload: string, rawAmount: number): string {
  const info = parseQrisInfo(staticPayload);
  const entries = parseTlv(info.cleanedPayload).filter((e) => e.tag !== '63');
  const amount = Math.max(0, Math.round(Number(rawAmount) || 0));

  const nextEntries: TlvEntry[] = [];
  let insertedAmount = false;

  for (const entry of entries) {
    if (entry.tag === '01') {
      nextEntries.push({ tag: '01', value: amount > 0 ? '12' : '11' });
      continue;
    }
    if (entry.tag === '54') {
      if (amount > 0 && !insertedAmount) {
        nextEntries.push({ tag: '54', value: String(amount) });
        insertedAmount = true;
      }
      continue;
    }
    if (amount > 0 && !insertedAmount && Number(entry.tag) > 54) {
      nextEntries.push({ tag: '54', value: String(amount) });
      insertedAmount = true;
    }
    nextEntries.push(entry);
  }

  if (amount > 0 && !insertedAmount) {
    nextEntries.push({ tag: '54', value: String(amount) });
  }

  const bodyWithoutCrc =
    nextEntries.map((e) => formatTlv(e.tag, e.value)).join('') + '6304';
  const crc = crc16Ccitt(bodyWithoutCrc);
  return `${bodyWithoutCrc}${crc}`;
}
