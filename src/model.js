export const DEFAULT_INTEREST_TAGS = [
  ["coffee", "☕ 咖啡"],
  ["tea", "🍵 茶"],
  ["food", "🍜 美食"],
  ["dessert", "🍰 甜點"],
  ["photo", "📷 攝影"],
  ["movie", "🎬 電影"],
  ["music", "🎵 音樂"],
  ["reading", "📚 閱讀"],
  ["travel", "✈️ 旅遊"],
  ["hiking", "🏔️ 登山"],
  ["sports", "🚴 運動"],
  ["cat", "🐱 貓"],
  ["dog", "🐶 狗"],
  ["game", "🎮 電玩"],
  ["plant", "🌱 植物"]
].map(([slug, name]) => ({
  id: `default-${slug}`,
  name,
  isDefault: true,
  createdAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T00:00:00.000Z",
  updatedByDeviceId: "system"
}));

export const DEFAULT_PERSON_GROUP_TAGS = [
  ["important-family", "重要家人"],
  ["close-friend", "摯友"],
  ["club-member", "社團成員"],
  ["car-friend", "車友"],
  ["classmate", "同學"],
  ["client", "客戶"]
].map(([slug, name]) => ({
  id: `default-group-${slug}`,
  name,
  isDefault: true,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
  updatedByDeviceId: "system"
}));

export function createDeviceId() {
  return `device-${crypto.randomUUID()}`;
}

export function createEmptyVault(deviceId) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    vaultId: `vault-${crypto.randomUUID()}`,
    people: [],
    personGroupTags: DEFAULT_PERSON_GROUP_TAGS.map((tag) => ({ ...tag })),
    interestTags: DEFAULT_INTEREST_TAGS.map((tag) => ({ ...tag })),
    customFieldDefs: [],
    deletedItems: [],
    tombstones: [],
    syncMeta: {
      updatedAt: now,
      updatedByDeviceId: deviceId,
      revision: 1
    }
  };
}

export function createPerson(deviceId, input) {
  const now = new Date().toISOString();
  return {
    id: `person-${crypto.randomUUID()}`,
    name: input.name.trim(),
    nationalId: input.nationalId?.trim() || "",
    birthDate: input.birthDate || "",
    phones: input.phones ?? [],
    addresses: input.addresses ?? [],
    personGroupTagIds: input.personGroupTagIds ?? [],
    interestTagIds: input.interestTagIds ?? [],
    favoriteItems: input.favoriteItems ?? [],
    familyMembers: input.familyMembers ?? [],
    lifeEvents: input.lifeEvents ?? [],
    customValues: input.customValues ?? [],
    note: input.note?.trim() || "",
    archivedAt: input.archivedAt ?? "",
    createdAt: now,
    updatedAt: now,
    updatedByDeviceId: deviceId
  };
}

export function touchVault(vault, deviceId) {
  return {
    ...vault,
    syncMeta: {
      ...vault.syncMeta,
      updatedAt: new Date().toISOString(),
      updatedByDeviceId: deviceId,
      revision: vault.syncMeta.revision + 1
    }
  };
}

export function sortPeople(people) {
  return [...people].sort((a, b) => {
    const byName = a.name.localeCompare(b.name, "zh-Hant-u-co-stroke");
    if (byName !== 0) return byName;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export function formatDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function daysUntil(value) {
  const diff = new Date(value).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
}
