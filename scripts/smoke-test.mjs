import { APP_CONFIG, driveFileName, driveProviderLabel, isGoogleDriveConfigured, isMockDrive } from "../src/config.js";
import { mergeVaults } from "../src/sync.js";
import { buildVaultXlsx } from "../src/xlsx.js";

const tests = [
  ["config defaults stay safe", testConfigDefaults],
  ["sync merge combines duplicate interest names and detects conflicts", testSyncMerge],
  ["sync merge supports legacy customValues object", testLegacyCustomValues],
  ["xlsx export produces an Excel workbook blob", testXlsxExport]
];

for (const [name, test] of tests) {
  await test();
  console.log(`✓ ${name}`);
}

console.log("Smoke tests passed.");

function testConfigDefaults() {
  assert(APP_CONFIG.appVersion === "0.1.0", "unexpected app version");
  assert(isMockDrive(), "drive provider should default to mock");
  assert(!isGoogleDriveConfigured(), "Google Drive should not be configured by default");
  assert(driveProviderLabel() === "本機模擬", "wrong drive provider label");
  assert(driveFileName("keyPackage") === "key-package.enc", "wrong key package filename");
  assert(driveFileName("vault") === "vault.enc", "wrong vault filename");
}

function testSyncMerge() {
  const local = vault({
    people: [
      person({
        id: "p1",
        name: "王小明",
        phones: [{ id: "phone-local", label: "手機", value: "0911", isDefault: true }],
        interestTagIds: ["tag-local", "interest-missing"],
        nationalId: "A123456789",
        birthDate: "2000-01-01",
        note: "本機備註",
        updatedAt: "2026-01-02T00:00:00.000Z"
      })
    ],
    interestTags: [tag({ id: "tag-local", name: "☕ 咖啡", createdAt: "2026-01-01T00:00:00.000Z" })],
    revision: 1
  });
  const remote = vault({
    people: [
      person({
        id: "p1",
        name: "王小明",
        phones: [{ id: "phone-remote", label: "手機", value: "0922", isDefault: false }],
        interestTagIds: ["tag-remote"],
        nationalId: "B123456789",
        birthDate: "2001-01-01",
        note: "雲端備註",
        updatedAt: "2026-01-03T00:00:00.000Z"
      })
    ],
    interestTags: [tag({ id: "tag-remote", name: "☕ 咖啡", createdAt: "2026-01-02T00:00:00.000Z" })],
    revision: 5
  });
  const result = mergeVaults(local, remote, "device-test");

  assert(result.vault.people.length === 1, "people should merge by id");
  assert(result.vault.people[0].phones.length === 2, "phones should be merged");
  assert(result.vault.interestTags.filter((item) => item.name === "☕ 咖啡").length === 1, "same-name interest tags should merge");
  assert(result.vault.interestTags.find((item) => item.id === "default-coffee")?.isDefault, "same-name interest tag should be absorbed into the default tag");
  assert(result.vault.people[0].interestTagIds.length === 1 && result.vault.people[0].interestTagIds[0] === "default-coffee", "person interest ids should be redirected");
  assert(result.conflicts.length === 1 && result.conflicts[0].field === "birthDate", "birthDate should be the remaining user-facing conflict");
  assert(result.vault.syncMeta.revision === 6, "revision should increment from max revision");
}

function testLegacyCustomValues() {
  const local = vault({
    people: [person({ id: "p1", customValues: { custom1: "舊格式" }, updatedAt: "2026-01-01T00:00:00.000Z" })],
    customFieldDefs: [customField({ id: "custom1", name: "關係" })],
    revision: 1
  });
  const remote = vault({
    people: [person({ id: "p1", customValues: [{ fieldId: "custom1", value: "新格式", updatedAt: "2026-01-02T00:00:00.000Z" }], updatedAt: "2026-01-02T00:00:00.000Z" })],
    customFieldDefs: [customField({ id: "custom1", name: "關係" })],
    revision: 2
  });
  const result = mergeVaults(local, remote, "device-test");

  assert(Array.isArray(result.vault.people[0].customValues), "customValues should normalize to array");
  assert(result.vault.people[0].customValues[0].value === "新格式", "newer custom value should win");
}

async function testXlsxExport() {
  const blob = buildVaultXlsx(
    vault({
      people: [
        person({
          id: "p1",
          name: "王小明",
          phones: [{ id: "phone1", label: "手機", value: "0911", isDefault: true }],
          interestTagIds: ["tag1"],
          customValues: [{ fieldId: "custom1", value: "朋友", updatedAt: "2026-01-02T00:00:00.000Z" }]
        })
      ],
      interestTags: [tag({ id: "tag1", name: "☕ 咖啡" })],
      customFieldDefs: [customField({ id: "custom1", name: "關係" })]
    }),
    "2026-08-20T00:00:00.000Z"
  );

  assert(blob.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "wrong xlsx mime type");
  assert(blob.size > 1000, "xlsx blob is unexpectedly small");
}

function vault({ people = [], interestTags = [], customFieldDefs = [], revision = 1 }) {
  return {
    schemaVersion: 1,
    vaultId: "vault-test",
    people,
    interestTags,
    customFieldDefs,
    deletedItems: [],
    tombstones: [],
    syncMeta: {
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedByDeviceId: "device-test",
      revision
    }
  };
}

function person(input = {}) {
  return {
    id: input.id ?? "person-test",
    name: input.name ?? "測試人物",
    nationalId: input.nationalId ?? "",
    birthDate: input.birthDate ?? "",
    phones: input.phones ?? [],
    addresses: input.addresses ?? [],
    interestTagIds: input.interestTagIds ?? [],
    customValues: input.customValues ?? [],
    note: input.note ?? "",
    createdAt: input.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-01-01T00:00:00.000Z",
    updatedByDeviceId: "device-test"
  };
}

function tag(input) {
  return {
    id: input.id,
    name: input.name,
    isDefault: false,
    createdAt: input.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-01-01T00:00:00.000Z",
    updatedByDeviceId: "device-test"
  };
}

function customField(input) {
  return {
    id: input.id,
    name: input.name,
    type: input.type ?? "text",
    scope: "global",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedByDeviceId: "device-test"
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
