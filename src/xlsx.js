const encoder = new TextEncoder();

export function buildVaultXlsx(vault, exportedAt) {
  const sheets = buildSheets(vault);
  return zipFiles([
    ["[Content_Types].xml", contentTypesXml(sheets)],
    ["_rels/.rels", rootRelsXml()],
    ["xl/workbook.xml", workbookXml(sheets)],
    ["xl/_rels/workbook.xml.rels", workbookRelsXml(sheets)],
    ["xl/styles.xml", stylesXml()],
    ...sheets.map((sheet, index) => [`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(sheet.rows)])
  ], `勿忘我資料匯出 ${exportedAt}`);
}

function buildSheets(vault) {
  const people = vault.people ?? [];
  const tags = vault.interestTags ?? [];
  const customFields = vault.customFieldDefs ?? [];
  const tagName = (id) => tags.find((tag) => tag.id === id)?.name ?? id;
  const fieldName = (id) => customFields.find((field) => field.id === id)?.name ?? id;
  const personName = (id) => people.find((person) => person.id === id)?.name ?? "";

  return [
    {
      name: "人物",
      rows: [
        ["人物ID", "姓名", "生日", "主要電話", "主要地址", "興趣喜好", "是否封存", "其它備註", "建立時間", "更新時間"],
        ...people.map((person) => [
          person.id,
          person.name,
          person.birthDate,
          defaultValue(person.phones),
          defaultValue(person.addresses),
          (person.interestTagIds ?? []).map(tagName).join("、"),
          person.archivedAt ? "是" : "",
          person.note,
          person.createdAt,
          person.updatedAt
        ])
      ]
    },
    {
      name: "電話",
      rows: [
        ["人物ID", "姓名", "標籤", "電話", "是否預設", "建立時間", "更新時間"],
        ...people.flatMap((person) => (person.phones ?? []).map((phone) => [
          person.id,
          person.name,
          phone.label,
          phone.value,
          phone.isDefault ? "是" : "",
          phone.createdAt,
          phone.updatedAt
        ]))
      ]
    },
    {
      name: "地址",
      rows: [
        ["人物ID", "姓名", "標籤", "地址", "是否預設", "建立時間", "更新時間"],
        ...people.flatMap((person) => (person.addresses ?? []).map((address) => [
          person.id,
          person.name,
          address.label,
          address.value,
          address.isDefault ? "是" : "",
          address.createdAt,
          address.updatedAt
        ]))
      ]
    },
    {
      name: "興趣喜好",
      rows: [
        ["興趣喜好ID", "名稱", "是否預設", "建立時間", "更新時間"],
        ...tags.map((tag) => [tag.id, tag.name, tag.isDefault ? "是" : "", tag.createdAt, tag.updatedAt])
      ]
    },
    {
      name: "人物興趣喜好",
      rows: [
        ["人物ID", "姓名", "興趣喜好ID", "興趣喜好"],
        ...people.flatMap((person) => (person.interestTagIds ?? []).map((id) => [person.id, person.name, id, tagName(id)]))
      ]
    },
    {
      name: "嗜好品",
      rows: [
        ["人物ID", "姓名", "嗜好品", "建立時間", "更新時間"],
        ...people.flatMap((person) => (person.favoriteItems ?? []).map((item) => [
          person.id,
          person.name,
          item.value,
          item.createdAt,
          item.updatedAt
        ]))
      ]
    },
    {
      name: "家族成員",
      rows: [
        ["人物ID", "姓名", "稱謂", "成員姓名", "連結人物ID", "建立時間", "更新時間"],
        ...people.flatMap((person) => (person.familyMembers ?? []).map((member) => [
          person.id,
          person.name,
          member.relationship,
          member.name,
          member.personId,
          member.createdAt,
          member.updatedAt
        ]))
      ]
    },
    {
      name: "重大事件",
      rows: [
        ["人物ID", "姓名", "日期", "內容", "建立時間", "更新時間"],
        ...people.flatMap((person) => (person.lifeEvents ?? []).map((event) => [
          person.id,
          person.name,
          event.date,
          event.text,
          event.createdAt,
          event.updatedAt
        ]))
      ]
    },
    {
      name: "自訂欄位",
      rows: [
        ["欄位ID", "欄位名稱", "欄位類型", "套用範圍", "選項", "指定人物ID", "指定人物姓名", "建立時間", "更新時間"],
        ...customFields.map((field) => [
          field.id,
          field.name,
          field.type,
          field.scope === "global" ? "所有人物" : "僅此人物",
          (field.options ?? []).join("、"),
          field.personId ?? "",
          field.personId ? personName(field.personId) : "",
          field.createdAt,
          field.updatedAt
        ])
      ]
    },
    {
      name: "自訂欄位值",
      rows: [
        ["人物ID", "姓名", "欄位ID", "欄位名稱", "值", "更新時間"],
        ...people.flatMap((person) => (person.customValues ?? []).map((value) => [
          person.id,
          person.name,
          value.fieldId,
          fieldName(value.fieldId),
          formatCellValue(value.value),
          value.updatedAt
        ]))
      ]
    }
  ];
}

function defaultValue(items = []) {
  const item = [...items].sort((a, b) => Number(b.isDefault) - Number(a.isDefault))[0];
  return item ? `${item.label} ${item.value}` : "";
}

function formatCellValue(value) {
  if (Array.isArray(value)) return value.join("、");
  return value ?? "";
}

function worksheetXml(rows) {
  return xmlDoc(`
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        ${rows.map((row, rowIndex) => rowXml(row, rowIndex + 1)).join("")}
      </sheetData>
    </worksheet>
  `);
}

function rowXml(row, rowNumber) {
  return `<row r="${rowNumber}">${row.map((value, index) => cellXml(value, columnName(index + 1), rowNumber)).join("")}</row>`;
}

function cellXml(value, column, rowNumber) {
  if (value === undefined || value === null || value === "") return `<c r="${column}${rowNumber}"/>`;
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${column}${rowNumber}"><v>${value}</v></c>`;
  return `<c r="${column}${rowNumber}" t="inlineStr"><is><t>${xmlEscape(String(value))}</t></is></c>`;
}

function columnName(index) {
  let name = "";
  while (index > 0) {
    const remainder = (index - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    index = Math.floor((index - 1) / 26);
  }
  return name;
}

function contentTypesXml(sheets) {
  return xmlDoc(`
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
      ${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
    </Types>
  `);
}

function rootRelsXml() {
  return xmlDoc(`
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
    </Relationships>
  `);
}

function workbookXml(sheets) {
  return xmlDoc(`
    <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets>
        ${sheets.map((sheet, index) => `<sheet name="${xmlAttr(sheet.name.slice(0, 31))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}
      </sheets>
    </workbook>
  `);
}

function workbookRelsXml(sheets) {
  return xmlDoc(`
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      ${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}
      <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
    </Relationships>
  `);
}

function stylesXml() {
  return xmlDoc(`
    <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
      <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
      <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
      <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
      <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
    </styleSheet>
  `);
}

function zipFiles(files, comment = "") {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach(([name, content]) => {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const localHeader = localFileHeader(nameBytes, data, crc);
    const centralHeader = centralDirectoryHeader(nameBytes, data, crc, offset);
    localParts.push(localHeader, data);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const commentBytes = encoder.encode(comment);
  const end = endOfCentralDirectory(files.length, centralSize, offset, commentBytes);
  return new Blob([...localParts, ...centralParts, end, commentBytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}

function localFileHeader(nameBytes, data, crc) {
  const header = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, data.length, true);
  view.setUint32(22, data.length, true);
  view.setUint16(26, nameBytes.length, true);
  header.set(nameBytes, 30);
  return header;
}

function centralDirectoryHeader(nameBytes, data, crc, offset) {
  const header = new Uint8Array(46 + nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint16(14, 0, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, data.length, true);
  view.setUint32(24, data.length, true);
  view.setUint16(28, nameBytes.length, true);
  view.setUint32(42, offset, true);
  header.set(nameBytes, 46);
  return header;
}

function endOfCentralDirectory(fileCount, centralSize, centralOffset, commentBytes) {
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, fileCount, true);
  view.setUint16(10, fileCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, commentBytes.length, true);
  return header;
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function xmlDoc(content) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${content.replace(/>\s+</g, "><").trim()}`;
}

function xmlEscape(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function xmlAttr(value) {
  return xmlEscape(value).replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
