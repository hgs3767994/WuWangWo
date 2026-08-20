import { isMockDrive } from "./config.js";
import { connectGoogleDrive, disconnectGoogleDrive, googleDriveAuthStatus, googleDriveReadiness, listGoogleDriveFiles, readGoogleDriveFile, removeGoogleDriveFile, testGoogleDriveConnection, writeGoogleDriveFile } from "./drive-google.js";
import { listMockDriveFiles, readMockDriveFile, removeMockDriveFile, writeMockDriveFile } from "./drive-mock.js";

export async function writeDriveFile(name, content) {
  if (isMockDrive()) return writeMockDriveFile(name, content);
  assertGoogleDriveReady();
  return writeGoogleDriveFile(name, content);
}

export async function readDriveFile(name) {
  if (isMockDrive()) return readMockDriveFile(name);
  assertGoogleDriveReady();
  return readGoogleDriveFile(name);
}

export async function removeDriveFile(name) {
  if (isMockDrive()) return removeMockDriveFile(name);
  assertGoogleDriveReady();
  return removeGoogleDriveFile(name);
}

export async function listDriveFiles() {
  if (isMockDrive()) return listMockDriveFiles();
  assertGoogleDriveReady();
  return listGoogleDriveFiles();
}

export async function connectDrive(options = {}) {
  if (isMockDrive()) return { connected: true };
  assertGoogleDriveReady();
  return connectGoogleDrive(options);
}

export function disconnectDrive() {
  if (isMockDrive()) return;
  disconnectGoogleDrive();
}

export function driveAuthStatus() {
  if (isMockDrive()) return { hasAccessToken: false, expiresAt: "" };
  return googleDriveAuthStatus();
}

export async function testDriveConnection() {
  if (isMockDrive()) {
    const testFileName = `diagnostic-${crypto.randomUUID()}.json`;
    const payload = { fileType: "forget-me-not-drive-diagnostic", createdAt: new Date().toISOString() };
    await writeMockDriveFile(testFileName, payload);
    const loaded = await readMockDriveFile(testFileName);
    await removeMockDriveFile(testFileName);
    return { ok: loaded?.fileType === payload.fileType, fileName: testFileName };
  }
  assertGoogleDriveReady();
  return testGoogleDriveConnection();
}

export function driveReadiness() {
  if (isMockDrive()) return { ready: true, message: "" };
  return googleDriveReadiness();
}

function assertGoogleDriveReady() {
  const readiness = googleDriveReadiness();
  if (!readiness.ready) throw new Error(readiness.message);
}
