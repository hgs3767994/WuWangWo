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

function mergeInterestTags(localVault, remoteVault) {
  const tagsById = byId(localVault.interestTags ?? []);
  const idRedirects = new Map();

  for (const remote of remoteVault.interestTags ?? []) {
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

  return { interestTags: [...tagsById.values()], idRedirects };
}

function rewriteInterestIds(person, redirects) {
  return {
    ...person,
    interestTagIds: uniqueBy(
      (person.interestTagIds ?? []).map((id) => redirects.get(id) ?? id).map((id) => ({ id })),
      (item) => item.id
    ).map((item) => item.id)
  };
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
  const people = byId((localVault.people ?? []).map((person) => rewriteInterestIds(person, idRedirects)));

  for (const remotePersonRaw of remoteVault.people ?? []) {
    const remotePerson = rewriteInterestIds(remotePersonRaw, idRedirects);
    const localPerson = people.get(remotePerson.id);
    if (localPerson) people.set(remotePerson.id, mergePerson(localPerson, remotePerson, conflicts));
    else people.set(remotePerson.id, remotePerson);
  }

  const filteredPeople = [...people.values()].filter((person) => !isTombstoned(tombstones, "person", person.id));
  const now = new Date().toISOString();

  return {
    vault: {
      ...localVault,
      people: filteredPeople,
      interestTags,
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
