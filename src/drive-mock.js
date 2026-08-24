import { getItem, removeItem, setItem } from "./db.js";
import { driveFileName } from "./config.js";

const DRIVE_PREFIX = "mockDrive:";

export async function writeMockDriveFile(name, content) {
  await setItem(`${DRIVE_PREFIX}${name}`, {
    name,
    content,
    updatedAt: new Date().toISOString()
  });
}

export async function readMockDriveFile(name) {
  const file = await getItem(`${DRIVE_PREFIX}${name}`);
  return file?.content ?? null;
}

export async function listMockDriveFileRevisions(name) {
  const file = await getItem(`${DRIVE_PREFIX}${name}`);
  return {
    file: file ? { id: name, name, modifiedTime: file.updatedAt } : null,
    revisions: []
  };
}

export async function readMockDriveFileRevision(name) {
  return readMockDriveFile(name);
}

export async function removeMockDriveFile(name) {
  await removeItem(`${DRIVE_PREFIX}${name}`);
}

export async function listMockDriveFiles() {
  const keyPackage = await readMockDriveFile(driveFileName("keyPackage"));
  const vault = await readMockDriveFile(driveFileName("vault"));
  return {
    hasKeyPackage: Boolean(keyPackage),
    hasVault: Boolean(vault)
  };
}
