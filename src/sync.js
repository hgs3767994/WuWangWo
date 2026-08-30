import { DEFAULT_INTEREST_TAGS, DEFAULT_PERSON_GROUP_TAGS } from "./model.js";

function byId(items) {
  return new Map(items.map((item) => [item.id, item]));
}

function newer(a, b) {
  return new Date(a?.updatedAt ?? a?.createdAt ?? 0).getTime() >= new Date(b?.updatedAt ?? b?.createdAt ?? 0).getTime() ? a : b;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeById(localItems, remoteItems) {
  const merged = byId(localItems);
  remoteItems.forEach((remote) => {
    const local = merged.get(remote.id);
    merged.set(remote.id, local ? newer(local, remote) : remote);
  });
  return [...merged.values()];
}

function mergeTombstones(localVault, remoteVault) {
  return mergeById(localVault.tombstones ?? [], remoteVault.tombstones ?? []);
}

function mergeDeletedItems(localVault, remoteVault) {
  return mergeById(localVault.deletedItems ?? [], remoteVault.deletedItems ?? []);
}

function isTombstoned(tombstones, type, id) {
  return tombstones.some((item) => item.type === type && item.id === id);
}

function mergeNamedTags(localItems = [], remoteItems = []) {
  const tagsById = byId(localItems);
  const idRedirects = new Map();

  for (const remote of remoteItems) {
    const sameId = tagsById.get(remote.id);
    if (sameId) {
      tagsById.set(remote.id, newer(sameId, remote));
      continue;
    }

    const sameName = [...tagsById.values()].find((tag) => tag.name === remote.name);
    if (sameName) {
      const keep = new Date(sameName.createdAt).getTime() <= new Date(remote.createdAt).getTime() ? sameName : remote;
      const drop = keep.id === sameName.id ? remote : sameName;
      tagsById.set(keep.id, keep);
      tagsById.delete(drop.id);
      idRedirects.set(drop.id, keep.id);
      continue;
    }

    tagsById.set(remote.id, remote);
  }

  return { tags: [...tagsById.values()], idRedirects };
}

function mergeInterestTags(localVault, remoteVault) {
  const { tags, idRedirects } = mergeNamedTags(localVault.interestTags ?? [], remoteVault.interestTags ?? []);
  return { interestTags: tags, idRedirects };
}

function mergePersonGroupTags(localVault, remoteVault) {
  const { tags, idRedirects } = mergeNamedTags(localVault.personGroupTags ?? [], remoteVault.personGroupTags ?? []);
  return { personGroupTags: tags, groupIdRedirects: idRedirects };
}

function canonicalDefaultTags(tags, defaultTags, tombstones, tombstoneType, deviceId, updatedAt) {
  const redirects = new Map();
  const defaultIds = new Set(defaultTags.map((tag) => tag.id));
  const output = [];
  const usedInputIds = new Set();

  defaultTags.forEach((defaultTag) => {
    if (isTombstoned(tombstones, tombstoneType, defaultTag.id)) return;
    const sameId = tags.find((tag) => tag.id === defaultTag.id);
    const sameName = tags.find((tag) => tag.id !== defaultTag.id && tag.name === defaultTag.name);
    const source = sameId ?? sameName;

    if (!source) {
      output.push({ ...defaultTag, updatedAt, updatedByDeviceId: deviceId });
      return;
    }

    usedInputIds.add(source.id);
    if (source.id !== defaultTag.id) redirects.set(source.id, defaultTag.id);
    output.push({
      ...source,
      id: defaultTag.id,
      name: defaultTag.name,
      isDefault: true,
      updatedAt: source.id === defaultTag.id && source.name === defaultTag.name ? source.updatedAt : updatedAt,
      updatedByDeviceId: source.updatedByDeviceId ?? deviceId
    });
  });

  const activeDefaultNames = new Set(output.map((tag) => tag.name));
  tags.forEach((tag) => {
    if (usedInputIds.has(tag.id)) return;
    if (defaultIds.has(tag.id)) return;
    if (isTombstoned(tombstones, tombstoneType, tag.id)) return;
    if (activeDefaultNames.has(tag.name)) return;
    output.push({ ...tag, isDefault: false });
  });

  return { tags: output, redirects };
}

function rewriteInterestIds(person, redirects, validIds = null) {
  const ids = uniqueBy(
    (person.interestTagIds ?? []).map((id) => resolveRedirect(id, redirects)).map((id) => ({ id })),
    (item) => item.id
  ).map((item) => item.id);
  return {
    ...person,
    interestTagIds: validIds ? ids.filter((id) => validIds.has(id)) : ids
  };
}

function rewritePersonGroupIds(person, redirects, validIds = null) {
  const ids = uniqueBy(
    (person.personGroupTagIds ?? []).map((id) => resolveRedirect(id, redirects)).map((id) => ({ id })),
    (item) => item.id
  ).map((item) => item.id);
  return {
    ...person,
    personGroupTagIds: validIds ? ids.filter((id) => validIds.has(id)) : ids
  };
}

function resolveRedirect(id, redirects) {
  let current = id;
  const seen = new Set();
  while (redirects.has(current) && !seen.has(current)) {
    seen.add(current);
    current = redirects.get(current);
  }
  return current;
}

function rewritePersonTagIds(person, interestRedirects, groupRedirects, validInterestIds = null, validGroupIds = null) {
  return rewritePersonGroupIds(rewriteInterestIds(person, interestRedirects, validInterestIds), groupRedirects, validGroupIds);
}

function mergeMultiValueItems(localItems = [], remoteItems = []) {
  const merged = mergeById(localItems, remoteItems);
  return uniqueBy(merged, (item) => `${item.label ?? ""}:${item.value ?? ""}`);
}

function normalizeCustomValues(values = []) {
  if (Array.isArray(values)) return values;
  return Object.entries(values).map(([fieldId, value]) => ({ fieldId, value }));
}

function mergeCustomValues(localValues = [], remoteValues = []) {
  const localList = normalizeCustomValues(localValues);
  const remoteList = normalizeCustomValues(remoteValues);
  const values = new Map(localList.map((item) => [item.fieldId, item]));
  remoteList.forEach((remote) => {
    const local = values.get(remote.fieldId);
    values.set(remote.fieldId, local ? newer(local, remote) : remote);
  });
  return [...values.values()];
}

function mergeNote(localPerson, remotePerson) {
  const localNote = localPerson.note ?? "";
  const remoteNote = remotePerson.note ?? "";
  if (!localNote) return remoteNote;
  if (!remoteNote || localNote === remoteNote) return localNote;
  const localStamp = localPerson.updatedAt?.slice(0, 10) ?? "未知時間";
  const remoteStamp = remotePerson.updatedAt?.slice(0, 10) ?? "未知時間";
  return `【本機於 ${localStamp} 修改】\n${localNote}\n\n【雲端於 ${remoteStamp} 修改】\n${remoteNote}`;
}

function mergePerson(localPerson, remotePerson, conflicts) {
  const base = newer(localPerson, remotePerson);
  const merged = {
    ...base,
    phones: mergeMultiValueItems(localPerson.phones, remotePerson.phones),
    addresses: mergeMultiValueItems(localPerson.addresses, remotePerson.addresses),
    personGroupTagIds: [...new Set([...(localPerson.personGroupTagIds ?? []), ...(remotePerson.personGroupTagIds ?? [])])],
    interestTagIds: [...new Set([...(localPerson.interestTagIds ?? []), ...(remotePerson.interestTagIds ?? [])])],
    favoriteItems: mergeMultiValueItems(localPerson.favoriteItems, remotePerson.favoriteItems),
    familyMembers: mergeById(localPerson.familyMembers ?? [], remotePerson.familyMembers ?? []),
    lifeEvents: mergeById(localPerson.lifeEvents ?? [], remotePerson.lifeEvents ?? []),
    customValues: mergeCustomValues(localPerson.customValues, remotePerson.customValues),
    note: mergeNote(localPerson, remotePerson),
    updatedAt: newer(localPerson, remotePerson).updatedAt,
    updatedByDeviceId: newer(localPerson, remotePerson).updatedByDeviceId
  };

  ["birthDate"].forEach((field) => {
    const localValue = localPerson[field] ?? "";
    const remoteValue = remotePerson[field] ?? "";
    if (localValue && remoteValue && localValue !== remoteValue) {
      merged[field] = localValue;
      conflicts.push({
        personId: localPerson.id,
        field,
        localValue,
        remoteValue
      });
    } else {
      merged[field] = localValue || remoteValue;
    }
  });

  return merged;
}

export function mergeVaults(localVault, remoteVault, deviceId) {
  const conflicts = [];
  const tombstones = mergeTombstones(localVault, remoteVault);
  const deletedItems = mergeDeletedItems(localVault, remoteVault);
  const { interestTags, idRedirects } = mergeInterestTags(localVault, remoteVault);
  const { personGroupTags, groupIdRedirects } = mergePersonGroupTags(localVault, remoteVault);
  const now = new Date().toISOString();
  const normalizedInterests = canonicalDefaultTags(interestTags, DEFAULT_INTEREST_TAGS, tombstones, "interestTag", deviceId, now);
  const normalizedPersonGroups = canonicalDefaultTags(personGroupTags, DEFAULT_PERSON_GROUP_TAGS, tombstones, "personGroupTag", deviceId, now);
  const combinedInterestRedirects = new Map([...idRedirects, ...normalizedInterests.redirects]);
  const combinedGroupRedirects = new Map([...groupIdRedirects, ...normalizedPersonGroups.redirects]);
  const validInterestIds = new Set(normalizedInterests.tags.map((tag) => tag.id));
  const validGroupIds = new Set(normalizedPersonGroups.tags.map((tag) => tag.id));
  const people = byId((localVault.people ?? []).map((person) => rewritePersonTagIds(person, combinedInterestRedirects, combinedGroupRedirects, validInterestIds, validGroupIds)));

  for (const remotePersonRaw of remoteVault.people ?? []) {
    const remotePerson = rewritePersonTagIds(remotePersonRaw, combinedInterestRedirects, combinedGroupRedirects, validInterestIds, validGroupIds);
    const localPerson = people.get(remotePerson.id);
    if (localPerson) people.set(remotePerson.id, mergePerson(localPerson, remotePerson, conflicts));
    else people.set(remotePerson.id, remotePerson);
  }

  const filteredPeople = [...people.values()].filter((person) => !isTombstoned(tombstones, "person", person.id));

  return {
    vault: {
      ...localVault,
      people: filteredPeople,
      personGroupTags: normalizedPersonGroups.tags,
      interestTags: normalizedInterests.tags,
      customFieldDefs: mergeById(localVault.customFieldDefs ?? [], remoteVault.customFieldDefs ?? []),
      deletedItems,
      tombstones,
      syncMeta: {
        updatedAt: now,
        updatedByDeviceId: deviceId,
        revision: Math.max(localVault.syncMeta?.revision ?? 0, remoteVault.syncMeta?.revision ?? 0) + 1
      }
    },
    conflicts
  };
}
